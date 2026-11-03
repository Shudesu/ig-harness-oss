import { accounts } from '../accounts.js';
import { webhook } from '../webhook.js';
import { InstagramClient } from '@ig-harness/ig-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { testDatabase } from '../../test-utils/d1.js';
import { trackedLinks } from '../tracked-links.js';
import { engagementGates } from '../engagement-gates.js';
import { lineConnections } from '../line-connections.js';
import { integrations } from '../integrations.js';
import { issueTrackingToken, verifyTrackingToken, TOKEN_TTL, issueIgLinkToken, deriveKey } from '../../lib/tracking-token.js';
import { openCredential, sealCredential, encryptLegacyCredentials, readAppSecret } from '../../lib/credential-crypto.js';
import { validateWorkerUrl } from '../../lib/worker-url.js';
import { rewriteTrackedMessage } from '../../lib/outbound-tracking.js';
import { wrapClickTracking } from '../../services/engagement-gate.js';
import type { Env } from '../../index.js';
const open: Array<{ close(): void }> = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const random = () => crypto.randomUUID();
async function fixture() {
  const { db, sqlite } = await testDatabase(); open.push(sqlite);
  const env = { DB: db, API_KEY: random(), IG_APP_SECRET: random(), WORKER_URL: 'https://worker.example', TRACKING_SIGNING_SECRET: random() } as Env['Bindings'];
  sqlite.prepare("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111',?,'2026-01-01','2026-01-01'),('b','222',?,'2026-01-01','2026-01-01')").run(random(), random());
  sqlite.exec(`INSERT INTO followers(id,igsid,account_id) VALUES(1,'1001','a'),(2,'1002','b');
    INSERT INTO tags(id,name,account_id) VALUES(1,'clicked','a');
    INSERT INTO scenarios(id,name,account_id,trigger_type) VALUES(1,'follow-up','a','manual');
    INSERT INTO tracked_links(id,name,destination_url,ref_code,account_id,tag_id,scenario_id) VALUES(1,'link','https://example.com/reward','ref','a',1,1);
    INSERT INTO engagement_gates(id,name,trigger_type,reward_url,account_id,initial_dm_text,follow_reminder_dm_text,reward_dm_text) VALUES('gate','gate','story_mention','https://example.com/reward','a','welcome','follow','reward');`);
  const app = new Hono<Env>(); app.use('*', async (c, next) => { c.set('staff', { id: 'owner', name: 'Owner', role: 'owner' }); await next(); }); app.route('/', accounts); app.route('/', webhook); app.route('/', trackedLinks); app.route('/', engagementGates); app.route('/', lineConnections); app.route('/', integrations);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  async function request(path: string, init?: RequestInit) { const response = await app.fetch(new Request(env.WORKER_URL + path, init), env, ctx); await Promise.all(pending.splice(0)); return response; }
  return { db, sqlite, env, request };
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('signed click boundary', () => {
  it.each(['ig=1001', 'lu=1001', 'f=1', 't=invalid&f=1'])('keeps legacy/invalid %s anonymous and redirects', async query => {
    const f = await fixture();
    const response = await f.request('/t/1?' + query);
    expect(response.status).toBe(302); expect(response.headers.get('location')).toBe('https://example.com/reward');
    expect(f.sqlite.prepare('SELECT follower_id FROM link_clicks').get()).toEqual({ follower_id: null });
    expect(f.sqlite.prepare('SELECT * FROM follower_tags').all()).toHaveLength(0);
    expect(f.sqlite.prepare('SELECT * FROM follower_scenarios').all()).toHaveLength(0);
  });
  it.each([{ igsid: '1001' }, { followerId: '1' }])('accepts signed identity %j and ignores unsigned overrides', async identity => {
    const f = await fixture(); const token = await issueTrackingToken(f.env, { purpose: 'link', linkId: '1', ...identity });
    expect((await f.request(`/t/1?t=${token}&f=2&ig=1002`)).status).toBe(302);
    expect(f.sqlite.prepare('SELECT follower_id FROM link_clicks').get()).toEqual({ follower_id: 1 });
    expect(f.sqlite.prepare('SELECT follower_id FROM follower_tags').all()).toEqual([{ follower_id: 1 }]);
    expect(f.sqlite.prepare('SELECT follower_id FROM follower_scenarios').all()).toEqual([{ follower_id: 1 }]);
  });
  it.each(['tampered', 'expired', 'other-link', 'other-account', 'other-purpose'])('rejects %s without losing redirect', async kind => {
    const f = await fixture();
    let token = (await issueTrackingToken(f.env, { purpose: kind === 'other-purpose' ? 'gate' : 'link', linkId: kind === 'other-link' ? '2' : '1', igsid: kind === 'other-account' ? '1002' : '1001' }, kind === 'expired' ? Date.now() - (TOKEN_TTL + 1) * 1000 : Date.now()))!;
    if (kind === 'tampered') token = token.slice(0, -5) + 'AAAAA';
    expect((await f.request(`/t/1?t=${token}&ig=1001`)).status).toBe(302);
    expect(f.sqlite.prepare('SELECT follower_id FROM link_clicks').get()).toEqual({ follower_id: null });
    expect(f.sqlite.prepare('SELECT * FROM follower_tags').all()).toHaveLength(0);
  });
  it('requires explicit legacy opt-in and never downgrades an invalid token', async () => {
    const f = await fixture(); f.env.TRACKING_ALLOW_UNSIGNED_ACTIONS = 'true';
    await f.request('/t/1?f=1'); await f.request('/t/1?t=&f=1');
    expect(f.sqlite.prepare('SELECT follower_id FROM link_clicks ORDER BY id').all()).toEqual([{ follower_id: 1 }, { follower_id: null }]);
  });
  it.each(['signed', 'legacy', 'tampered', 'expired', 'changed-destination'])('handles %s gate clicks without forwarding raw identity', async kind => {
    const f = await fixture(); const destination = 'https://example.com/reward?ig=1001&igt=untrusted';
    const token = await issueTrackingToken(f.env, { purpose: 'gate', linkId: 'gate', igsid: '1001', destination }, kind === 'expired' ? Date.now() - (TOKEN_TTL + 1) * 1000 : Date.now());
    const target = kind === 'changed-destination' ? destination + '&changed=1' : destination;
    const u = Buffer.from(target).toString('base64url');
    const response = await f.request(`/click/gate?u=${u}&ig=1002${kind === 'legacy' ? '' : `&t=${kind === 'tampered' ? 'invalid' : token}`}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.has('ig')).toBe(false);
    expect(location.searchParams.has('igt')).toBe(kind === 'signed');
    expect(f.sqlite.prepare('SELECT igsid FROM gate_clicks').get()).toEqual({ igsid: kind === 'signed' ? '1001' : null });
    expect(f.sqlite.prepare('SELECT destination_url,referer FROM gate_clicks').get()).toEqual({ destination_url: 'https://example.com/reward', referer: null });
  });
});

it('signs text and nested rich URLs at the outbound boundary with the actual recipient', async () => {
  const env = { API_KEY: random(), WORKER_URL: 'https://worker.example' };
  const output = await rewriteTrackedMessage(env, '1001', { text: 'Go https://worker.example/t/1?f=2', buttons: [{ url: 'https://worker.example/t/2?ig=1002' }], external: 'https://else.example/t/1?ig=1002' }) as any;
  for (const [value, id] of [[output.text.slice(3), '1'], [output.buttons[0].url, '2']]) {
    const url = new URL(value); expect(url.searchParams.has('ig')).toBe(false); expect(url.searchParams.has('f')).toBe(false);
    expect(await verifyTrackingToken(env, url.searchParams.get('t')!, 'link', id)).toMatchObject({ igsid: '1001' });
  }
  expect(output.external).toBe('https://else.example/t/1?ig=1002');
  const gate = new URL(await wrapClickTracking(env.WORKER_URL, 'gate', 'https://example.com', '1001', env));
  expect(await verifyTrackingToken(env, gate.searchParams.get('t')!, 'gate', 'gate', 'https://example.com')).toMatchObject({ igsid: '1001' });
});
it('implements spec 08 HKDF and HMAC wire format with no shared key => anonymous', async () => {
  const secret = random(); const env = { LINE_HARNESS_LINK_SECRET: secret };
  const token = (await issueIgLinkToken(env, '1001', '111'))!;
  const [part, mac] = token.split('.'); const bytes = await deriveKey(secret, 'ig-link-token-v1');
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  expect(await crypto.subtle.verify('HMAC', key, Buffer.from(mac!, 'base64url'), new TextEncoder().encode(part))).toBe(true);
  expect(JSON.parse(Buffer.from(part!, 'base64url').toString())).toMatchObject({ v: 1, igsid: '1001', iga: '111' });
  expect(await issueIgLinkToken({}, '1001')).toBeNull();
  expect(await issueTrackingToken({}, { purpose: 'link', linkId: '1', igsid: '1001' })).toBeNull();
});

it('encrypts with AAD, reads legacy plaintext, rejects corruption and supports fallback after dedicated key provisioning', async () => {
  const env = { API_KEY: random() }; const value = random(); const subject = 'line-api-key:row';
  const sealed = await sealCredential(value, subject, env);
  expect(sealed.startsWith('enc:v1:')).toBe(true); expect(sealed).not.toContain(value);
  expect(await openCredential(sealed, subject, env)).toBe(value);
  expect(await openCredential(value, subject, {})).toBe(value);
  await expect(openCredential(sealed, subject + 'other', env)).rejects.toThrow();
  await expect(openCredential(sealed.slice(0, -4) + 'AAAA', subject, env)).rejects.toThrow();
  await expect(openCredential('enc:v2:unsupported', subject, env)).rejects.toThrow();
  const upgraded = { ...env, TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))) };
  expect(await openCredential(sealed, subject, upgraded)).toBe(value);
  expect(await openCredential(await sealCredential(value, subject, upgraded), subject, upgraded)).toBe(value);
});
it('migrates existing app secrets and LINE keys idempotently and retains masked API responses', async () => {
  const f = await fixture(); const appSecret = random(); const apiKey = random();
  f.sqlite.prepare('UPDATE ig_accounts SET app_secret=? WHERE id=?').run(appSecret, 'a');
  f.sqlite.prepare("INSERT INTO line_harness_connections(id,name,worker_url,api_key) VALUES('c','line','https://line.example',?)").run(apiKey);
  await encryptLegacyCredentials(f.db, f.env);
  const row = f.sqlite.prepare("SELECT * FROM ig_accounts WHERE id='a'").get() as any;
  expect(row.app_secret.startsWith('enc:v1:')).toBe(true); expect(await readAppSecret(row, f.env)).toBe(appSecret);
  const key = f.sqlite.prepare("SELECT api_key FROM line_harness_connections WHERE id='c'").get()!.api_key;
  expect(String(key).startsWith('enc:v1:')).toBe(true);
  await encryptLegacyCredentials(f.db, f.env);
  expect(f.sqlite.prepare("SELECT api_key FROM line_harness_connections WHERE id='c'").get()!.api_key).toBe(key);
  const response = await f.request('/api/line-connections'); const body = await response.text();
  expect(body).not.toContain(apiKey); expect(body).not.toContain('enc:v1:'); expect(body).toContain('••••');
});
it('encrypts connection create/update and legacy config writes and decrypts only for validated fetch', async () => {
  const f = await fixture(); const apiKey = random(); const next = random();
  const created = await f.request('/api/line-connections', json({ name: 'line', worker_url: 'https://line.example', api_key: apiKey }));
  expect(created.status).toBe(200); const { data } = await created.json() as any;
  const stored = () => String(f.sqlite.prepare('SELECT api_key FROM line_harness_connections WHERE id=?').get(data.id)!.api_key);
  expect(await openCredential(stored(), `line-api-key:${data.id}`, f.env)).toBe(apiKey);
  expect((await f.request(`/api/line-connections/${data.id}`, json({ api_key: next }, 'PATCH'))).status).toBe(200);
  expect(await openCredential(stored(), `line-api-key:${data.id}`, f.env)).toBe(next);
  const mocked = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ data: [] })); vi.stubGlobal('fetch', mocked);
  expect((await f.request(`/api/line-connections/${data.id}/test`, json({}))).status).toBe(200);
  expect(new Headers(mocked.mock.calls[0]![1]?.headers).get('Authorization')).toBe(`Bearer ${next}`);
  expect(mocked.mock.calls[0]![1]?.redirect).toBe('error');
  expect((await f.request('/api/integrations/line-harness/config', json({ url: 'https://line.example', api_key: apiKey }))).status).toBe(200);
  expect(String(f.sqlite.prepare("SELECT value FROM integration_settings WHERE key='line_harness_api_key'").get()!.value).startsWith('enc:v1:')).toBe(true);
});
it.each(['http://example.com', 'https://localhost', 'https://sub.localhost.', 'https://10.1.2.3', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://172.16.1.1', 'https://192.168.1.1', 'https://169.254.169.254', 'https://100.100.100.200', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fc00::1]', 'https://metadata.google.internal', 'https://u:p@example.com', 'https://example.com?q=1'])('rejects unsafe worker_url %s on validation, save and send', async url => {
  expect(() => validateWorkerUrl(url)).toThrow();
  const f = await fixture(); const mocked = vi.fn(); vi.stubGlobal('fetch', mocked);
  expect((await f.request('/api/line-connections', json({ name: 'line', worker_url: url, api_key: random() }))).status).toBe(400);
  f.sqlite.prepare("INSERT INTO line_harness_connections(id,name,worker_url,api_key) VALUES('c','old',?,?)").run(url, random());
  expect((await f.request('/api/line-connections/c', json({ worker_url: url }, 'PATCH'))).status).toBe(400);
  expect((await f.request('/api/line-connections/c/test', json({}))).status).toBe(502);
  expect(mocked).not.toHaveBeenCalled(); expect(f.sqlite.prepare("SELECT id FROM line_harness_connections WHERE id='c'").get()).toBeTruthy();
});

it('encrypts account app_secret create/update and uses it for webhook signature verification', async () => {
  const f = await fixture(); const appSecret = random(); const nextSecret = random();
  f.env.TOKEN_ENCRYPTION_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ user_id: '333', username: 'verified_user' })));
  const response = await f.request('/api/accounts', json({ igUserId: '333', accessToken: random(), appSecret }));
  expect(response.status).toBe(201); const body = await response.text(); expect(body).not.toContain(appSecret);
  const row = f.sqlite.prepare("SELECT * FROM ig_accounts WHERE ig_user_id='333'").get() as any;
  expect(row.app_secret.startsWith('enc:v1:')).toBe(true); expect(await readAppSecret(row, f.env)).toBe(appSecret);
  expect((await f.request(`/api/accounts/${row.id}`, json({ appSecret: nextSecret }, 'PATCH'))).status).toBe(200);
  expect(await readAppSecret(f.sqlite.prepare('SELECT * FROM ig_accounts WHERE id=?').get(row.id) as any, f.env)).toBe(nextSecret);
  const payload = JSON.stringify({ object: 'instagram', entry: [] });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(nextSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('hex');
  expect((await f.request('/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': 'sha256=' + signature }, body: payload })).status).toBe(200);
  expect((await f.request('/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }, body: payload })).status).toBe(403);
});
it('applies the SDK outbound hook to text/templates/quick replies, and anonymizes private comment replies', async () => {
  const env = { API_KEY: random(), WORKER_URL: 'https://worker.example' };
  const mocked = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ recipient_id: '1001', message_id: 'sent' }));
  vi.stubGlobal('fetch', mocked);
  const client = new InstagramClient({ accessToken: random(), igUserId: '111', transformMessage: (id, message) => rewriteTrackedMessage(env, id, message) });
  const url = env.WORKER_URL + '/t/1?ig=someone';
  await client.sendText('1001', url);
  await client.sendGenericTemplate('1001', [{ title: 'Reward', buttons: [{ type: 'web_url', title: 'Open', url }] }]);
  await client.sendQuickReply('1001', url, [{ content_type: 'text', title: 'OK', payload: 'OK' }]);
  await client.sendPrivateReply('comment', url);
  for (const call of mocked.mock.calls.slice(0, 3)) {
    const serialized = call[1]!.body as string;
    expect(serialized).not.toContain('?ig='); expect(serialized).toContain('?t=');
  }
  const privateMessage = JSON.parse(mocked.mock.calls[3]![1]!.body as string);
  expect(privateMessage.message.text).toBe(env.WORKER_URL + '/t/1');
});
