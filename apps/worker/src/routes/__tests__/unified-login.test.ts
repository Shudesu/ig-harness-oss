import { it, expect, vi, afterEach, describe } from 'vitest';
import { Hono } from 'hono';
import { accounts } from '../accounts.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
import { refreshAccountTokenIfNeeded } from '../../lib/ig-token.js';
import { getAccountClient, ensureDefaultAccount, envConnectionType } from '../../lib/accounts.js';
import { resolveConnectionType } from '../../lib/validate-ig-account.js';
import { testDatabase } from '../../test-utils/d1.js';

afterEach(() => vi.unstubAllGlobals());
const KEY = btoa('01234567890123456789012345678901');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function fixture() {
  const f = await gateFixture();
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'owner', name: 'Owner', role: 'owner' }); await next(); });
  app.route('/', accounts);
  const env: any = { DB: f.db, IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test', IG_APP_SECRET: 'secret', TOKEN_ENCRYPTION_KEY: KEY };
  const request = (path: string, method: string, body?: unknown) => app.request('https://worker.example' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const row = (where: string) => f.sqlite.prepare(`SELECT * FROM ig_accounts WHERE ${where}`).get() as any;
  return { ...f, env, request, row };
}

describe('connection type resolution', () => {
  it('prefers an explicit choice, then the token prefix, then Instagram Login', () => {
    expect(resolveConnectionType('EAAx')).toBe('facebook_login');
    expect(resolveConnectionType('IGAAx')).toBe('instagram_login');
    expect(resolveConnectionType('opaque')).toBe('instagram_login');
    expect(resolveConnectionType('IGAAx', 'facebook_login')).toBe('facebook_login');
    expect(() => resolveConnectionType('EAAx', 'page_token')).toThrow('connectionType');
  });
  it('seeds the env default account with the env override or token prefix', () => {
    expect(envConnectionType({}, 'IGAA')).toBe('instagram_login');
    expect(envConnectionType({}, 'EAA')).toBe('facebook_login');
    expect(envConnectionType({ IG_CONNECTION_TYPE: 'instagram_login' }, 'EAA')).toBe('instagram_login');
  });
});

it('existing rows default to instagram_login after migration 0025', async () => {
  const f = await fixture(); try {
    expect(f.row("id='a'")).toMatchObject({ connection_type: 'instagram_login', page_id: null });
    expect(() => f.sqlite.prepare("UPDATE ig_accounts SET connection_type='other' WHERE id='a'").run()).toThrow();
  } finally { f.sqlite.close(); }
});

it('registers an EAA token with an explicit IG user id against graph.facebook.com', async () => {
  const f = await fixture(); try {
    const fetch = vi.fn().mockResolvedValue(json({ id: '17841400000000001', username: 'new_owner' })); vi.stubGlobal('fetch', fetch);
    const res = await f.request('/api/accounts', 'POST', { igUserId: '17841400000000001', accessToken: 'EAAsecret-token' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data).toMatchObject({ igUserId: '17841400000000001', username: 'new_owner', connectionType: 'facebook_login', pageId: null });
    expect(JSON.stringify(body)).not.toContain('EAAsecret-token');
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://graph.facebook.com/v25.0/17841400000000001?fields=id,username');
    expect(f.row("ig_user_id='17841400000000001'")).toMatchObject({ connection_type: 'facebook_login', access_token: expect.stringMatching(/^enc:v1:/) });
  } finally { f.sqlite.close(); }
});

it('finds the IG account through the Facebook Page when no IG user id is given', async () => {
  const f = await fixture(); try {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [{ id: '555', name: 'Shop', instagram_business_account: { id: '17841400000000002', username: 'shop' } }] }))
      .mockResolvedValueOnce(json({ id: '17841400000000002', username: 'shop' }));
    vi.stubGlobal('fetch', fetch);
    const res = await f.request('/api/accounts', 'POST', { accessToken: 'EAApage' });
    expect(res.status).toBe(201);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe('/v25.0/me/assigned_instagram_accounts');
    expect(new URL(String(fetch.mock.calls[1]?.[0])).pathname).toBe('/v25.0/me/accounts');
    expect(f.row("ig_user_id='17841400000000002'")).toMatchObject({ connection_type: 'facebook_login', page_id: '555', username: 'shop' });
  } finally { f.sqlite.close(); }
});

it('finds the IG account assigned to a Unified login system-user token without a Page', async () => {
  const f = await fixture(); try {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: '17841400000000004', username: 'suat_owner' }] }))
      .mockResolvedValueOnce(json({ id: '17841400000000004', username: 'suat_owner' }));
    vi.stubGlobal('fetch', fetch);
    expect((await f.request('/api/accounts', 'POST', { accessToken: 'EAAsuat' })).status).toBe(201);
    expect(f.row("ig_user_id='17841400000000004'")).toMatchObject({ connection_type: 'facebook_login', page_id: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { f.sqlite.close(); }
});

it('asks for the IG user id when Pages reveal none or several IG accounts, without saving', async () => {
  const f = await fixture(); try {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: [] })));
    const none = await f.request('/api/accounts', 'POST', { accessToken: 'EAAx' });
    expect(none.status).toBe(400); expect((await none.json() as any).error).toContain('Instagram user ID');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [{ id: '201' }, { id: '202' }] })));
    const many = await f.request('/api/accounts', 'POST', { accessToken: 'EAAx' });
    expect(many.status).toBe(400); expect((await many.json() as any).error).toContain('201, 202');
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM ig_accounts').get()).toMatchObject({ n: 1 });
  } finally { f.sqlite.close(); }
});

it('rejects an EAA token that reads a different IG account and keeps IG Login tokens on graph.instagram.com', async () => {
  const f = await fixture(); try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ id: '999', username: 'someone' })));
    expect((await f.request('/api/accounts', 'POST', { igUserId: '17841400000000003', accessToken: 'EAAx' })).status).toBe(400);
    const fetch = vi.fn().mockResolvedValue(json({ user_id: '333', username: 'ig_user' })); vi.stubGlobal('fetch', fetch);
    expect((await f.request('/api/accounts', 'POST', { accessToken: 'IGAAx' })).status).toBe(201);
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://graph.instagram.com/v25.0/me?fields=user_id,username');
    expect(f.row("ig_user_id='333'")).toMatchObject({ connection_type: 'instagram_login' });
    expect((await f.request('/api/accounts', 'POST', { accessToken: 'EAAx', connectionType: 'nope' })).status).toBe(400);
  } finally { f.sqlite.close(); }
});

it('switches an existing account to Unified login only with a validated replacement token', async () => {
  const f = await fixture(); try {
    expect((await f.request('/api/accounts/a', 'PATCH', { connectionType: 'facebook_login' })).status).toBe(400);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ id: '111', username: 'owner' })));
    const res = await f.request('/api/accounts/a', 'PATCH', { accessToken: 'EAAnew' });
    expect(res.status).toBe(200);
    expect((await res.json() as any).data).toMatchObject({ connectionType: 'facebook_login' });
    expect(f.row("id='a'")).toMatchObject({ connection_type: 'facebook_login' });
  } finally { f.sqlite.close(); }
});

it('never calls the Instagram refresh endpoint for Unified login tokens', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const db = await testDatabase(); try {
    const result = await refreshAccountTokenIfNeeded({ IG_ACCESS_TOKEN: '' } as any, db.db, { id: 'x', ig_user_id: '1', access_token: 'EAA', token_expires_at: null, is_default: 0, connection_type: 'facebook_login' } as any);
    expect(result).toMatchObject({ refreshed: false });
    expect(fetch).not.toHaveBeenCalled();
  } finally { db.sqlite.close(); }
});

it('builds a graph.facebook.com client for Unified login accounts and keeps the default account unchanged', async () => {
  const f = await fixture(); try {
    f.sqlite.prepare("UPDATE ig_accounts SET token_expires_at=? WHERE id='a'").run(Math.floor(Date.now() / 1000) + 60 * 86400);
    f.sqlite.prepare("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at,connection_type,page_id) VALUES('b','178','EAAstored',0,'2026-01-01','2026-01-01','facebook_login',NULL)").run();
    const fetch = vi.fn().mockImplementation(async () => json({ recipient_id: 'r', message_id: 'm' })); vi.stubGlobal('fetch', fetch);
    await (await getAccountClient(f.env, f.db, f.row("id='a'"))).sendText('user', 'hi');
    await (await getAccountClient(f.env, f.db, f.row("id='b'"))).sendText('user', 'hi');
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[0]?.origin + urls[0]?.pathname).toBe('https://graph.instagram.com/v25.0/111/messages');
    expect(urls[1]?.origin + urls[1]?.pathname).toBe('https://graph.facebook.com/v25.0/178/messages');
    expect(urls.some((u) => u.pathname.includes('refresh_access_token'))).toBe(false);
  } finally { f.sqlite.close(); }
});

it('subscribes webhooks on the node that matches the connection type', async () => {
  const f = await fixture(); try {
    f.sqlite.prepare("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at,connection_type,page_id) VALUES('b','178','EAAstored',0,'2026-01-01','2026-01-01','facebook_login','555')").run();
    const fields = ['messages', 'messaging_postbacks', 'messaging_referral', 'comments'];
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => json(init.method === 'POST' ? { success: true } : { data: [{ subscribed_fields: fields }] }));
    vi.stubGlobal('fetch', fetch);
    const res = await f.request('/api/accounts/b/subscribe-webhooks', 'POST');
    expect(res.status).toBe(200);
    expect((await res.json() as any).data).toEqual({ connectionType: 'facebook_login', node: 'page', fields });
    expect(new URL(String(fetch.mock.calls[0]?.[0])).origin + new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe('https://graph.facebook.com/v25.0/555/subscribed_apps');
    expect((await f.request('/api/accounts/missing/subscribe-webhooks', 'POST')).status).toBe(404);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 200 } }, 403)));
    expect((await f.request('/api/accounts/b/subscribe-webhooks', 'POST')).status).toBe(400);
  } finally { f.sqlite.close(); }
});

it('seeds an EAA env token as a Unified login default account', async () => {
  const db = await testDatabase(); try {
    await ensureDefaultAccount({ IG_USER_ID: '178', IG_ACCESS_TOKEN: 'EAAenv', TOKEN_ENCRYPTION_KEY: KEY } as any, db.db);
    expect(db.sqlite.prepare("SELECT connection_type FROM ig_accounts WHERE ig_user_id='178'").get()).toMatchObject({ connection_type: 'facebook_login' });
  } finally { db.sqlite.close(); }
});
