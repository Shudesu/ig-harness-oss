import { afterEach, it, expect, vi } from 'vitest';
import worker from '../../index.js';
import { testDatabase } from '../../test-utils/d1.js';
import { createStaffMember, getStaffByApiKey } from '@ig-harness/db';
import { recordCronRun } from '../../lib/health.js';
import { sealToken, openToken } from '../../lib/token-crypto.js';
const open: Array<{ close(): void }> = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); vi.useRealTimers(); });
async function fixture() {
  const { sqlite, db } = await testDatabase(); open.push(sqlite);
  const env: any = { DB: db, API_KEY: 'owner-key', IG_APP_SECRET: 'app-secret', IG_USER_ID: '', IG_ACCESS_TOKEN: '', IG_VERIFY_TOKEN: 'verify', TOKEN_ENCRYPTION_KEY: btoa('01234567890123456789012345678901'), ADMIN_ORIGINS: 'https://admin.example', WORKER_URL: 'https://worker.example' };
  const context: any = { waitUntil: (promise: Promise<unknown>) => promise.catch(() => {}), passThroughOnException() {} };
  const request = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://worker.example${path}`, init), env, context);
  return { sqlite, db, env, request };
}
async function signed(secret: string, userId = '123') {
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: Math.floor(Date.now() / 1000) })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64url');
  return `${sig}.${payload}`;
}
it('escapes connect tokens, refuses fake deletion codes, and has no personal LINE default', async () => {
  const { request, env } = await fixture(); const attack = '<script>alert(1)</script>';
  const html = await (await request(`/connect?uid=x&token=${encodeURIComponent(attack)}`)).text();
  expect(html).not.toContain(attack); expect((await request(`/connect?uid=x&token=${encodeURIComponent(attack)}`)).status).toBe(400);
  expect((await request(`/data-deletion?code=${encodeURIComponent(attack)}`)).status).toBe(404);
  expect((await request('/line')).status).toBe(503); expect((await request('/line?test=1')).status).toBe(404);
  expect((await request('/connect?uid=x&token=valid-token-123')).status).toBe(503);
  env.IG_USERNAME = 'configured_account';
  const connected = await request('/connect?uid=x&token=valid-token-123');
  expect(connected.status).toBe(200); expect(await connected.text()).toContain('https://ig.me/m/configured_account');
  env.IG_USERNAME = 'bad"><script>';
  expect((await request('/connect?uid=x&token=valid-token-123')).status).toBe(503);
});
it('fails closed for blank bearer tokens and rejects disallowed origins', async () => {
  const { request, env } = await fixture(); env.API_KEY = '';
  expect((await request('/api/staff/me', { headers: { Authorization: 'Bearer ' } })).status).toBe(401);
  const bad = await request('/api/staff/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  const good = await request('/api/staff/me', { method: 'OPTIONS', headers: { Origin: 'https://admin.example', 'Access-Control-Request-Method': 'GET' } });
  expect(good.headers.get('access-control-allow-origin')).toBe('https://admin.example');
});
it('stores staff hashes and blocks staff sends/configuration before route side effects', async () => {
  const { db, sqlite, request } = await fixture();
  const staff = await createStaffMember(db, { name: 'Viewer', role: 'staff' });
  const stored = sqlite.prepare('SELECT api_key FROM staff_members WHERE id=?').get(staff.id)?.api_key;
  expect(stored).not.toBe(staff.api_key); expect(stored).toMatch(/^sha256:/);
  expect((await getStaffByApiKey(db, staff.api_key))?.id).toBe(staff.id);
  expect(await getStaffByApiKey(db, stored as string)).toBeNull();
  for (const path of ['/api/broadcasts/1/send','/api/friends/1/messages','/api/media-posts','/api/scenarios']) expect((await request(path, { method: 'POST', headers: { Authorization: `Bearer ${staff.api_key}` } })).status).toBe(403);
  expect((await request('/api/integrations/line-harness/config', { headers: { Authorization: `Bearer ${staff.api_key}` } })).status).toBe(403);
});
it('verifies deletion HMAC, records a truthful status and purges only the verified subject', async () => {
  const { request, sqlite } = await fixture();
  const invalid = await request('/data-deletion', { method: 'POST', body: new URLSearchParams({ signed_request: await signed('wrong') }) }); expect(invalid.status).toBe(403);
  const raw = await signed('app-secret');
  const response = await request('/data-deletion', { method: 'POST', body: new URLSearchParams({ signed_request: raw }) });
  expect(response.status).toBe(200); const body = await response.json() as { confirmation_code: string };
  expect(await (await request(`/data-deletion?code=${body.confirmation_code}`)).text()).toContain('not yet been deleted');
  const again = await (await request('/data-deletion', { method: 'POST', body: new URLSearchParams({ signed_request: raw }) })).json() as any; expect(again.confirmation_code).toBe(body.confirmation_code);
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'456','a'),(2,'789','a'); INSERT INTO messages_log(follower_id,direction,message_type,body) VALUES(1,'in','text','private'),(2,'in','text','keep')");
  const resolve = await request(`/api/data-deletion/${body.confirmation_code}/resolve`, { method: 'POST', headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'a', followerId: 1, identityVerified: true }) });
  expect(resolve.status).toBe(200); expect(sqlite.prepare('SELECT id FROM followers').all()).toEqual([{ id: 2 }]); expect(sqlite.prepare('SELECT body FROM messages_log').get()).toMatchObject({ body: 'keep' });
  expect(await (await request(`/data-deletion?code=${body.confirmation_code}`)).text()).toContain('Deletion completed');
});
it('encrypts tokens with random IVs and account binding; wrong keys cannot decrypt', async () => {
  const key = btoa('01234567890123456789012345678901');
  const encrypted = await sealToken('sensitive-token', 'account-a', key);
  expect(encrypted).not.toContain('sensitive-token'); expect(await sealToken('sensitive-token', 'account-a', key)).not.toBe(encrypted);
  expect(await openToken(encrypted, 'account-a', key)).toBe('sensitive-token');
  await expect(openToken(encrypted, 'account-b', key)).rejects.toThrow('cannot be decrypted');
  await expect(sealToken('test', 'account-a')).rejects.toThrow('required');
});
it('throttles heartbeat writes while retaining a periodic liveness timestamp', async () => {
  const { db, sqlite } = await fixture(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
  await recordCronRun(db); const first = sqlite.prepare("SELECT value FROM integration_settings WHERE key='health:last_cron_at'").get()?.value;
  vi.advanceTimersByTime(5 * 60_000); await recordCronRun(db); expect(sqlite.prepare("SELECT value FROM integration_settings WHERE key='health:last_cron_at'").get()?.value).toBe(first);
  vi.advanceTimersByTime(10 * 60_000); await recordCronRun(db); expect(sqlite.prepare("SELECT value FROM integration_settings WHERE key='health:last_cron_at'").get()?.value).not.toBe(first);
});
it('does no Graph calls or D1 writes on an idle tick with fresh probes/heartbeat', async () => {
  const { db, env, sqlite } = await fixture();
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('account_backfill_done','1')");
  // Use an already-encrypted token so this is truly a post-upgrade idle tick.
  sqlite.prepare('UPDATE ig_accounts SET access_token=?').run(await sealToken('test', '111', env.TOKEN_ENCRYPTION_KEY));
  sqlite.prepare('INSERT INTO integration_settings(key,value) VALUES(?,?)').run('health:token_valid:a', JSON.stringify({ ok: true, checked_at: new Date().toISOString() }));
  await recordCronRun(db);
  const before = sqlite.prepare('SELECT total_changes() AS n').get()?.n;
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const { runScheduledJobs } = await import('../../index.js');
  const pending: Promise<unknown>[] = [];
  await runScheduledJobs(env, { waitUntil: (task) => { pending.push(task); } }); await Promise.all(pending);
  expect(fetch).not.toHaveBeenCalled(); expect(sqlite.prepare('SELECT total_changes() AS n').get()?.n).toBe(before);
  vi.unstubAllGlobals();
});
it('does not complete a deletion while another mutation is in flight', async () => {
  const { db, request, sqlite } = await fixture();
  const response = await (await request('/data-deletion', { method: 'POST', body: new URLSearchParams({ signed_request: await signed('app-secret') }) })).json() as any;
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,created_at,updated_at) VALUES('a','111','test','2026-01-01','2026-01-01'); INSERT INTO followers(id,igsid,account_id) VALUES(1,'456','a'); INSERT INTO active_mutations(id,started_at) VALUES('inflight','2026-10-26')");
  const resolve = () => request(`/api/data-deletion/${response.confirmation_code}/resolve`, { method: 'POST', headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'a', followerId: 1, identityVerified: true }) });
  expect((await resolve()).status).toBe(409); expect(sqlite.prepare('SELECT COUNT(*) AS n FROM followers').get()?.n).toBe(1);
  const { beginActivity } = await import('../../lib/activity.js'); expect(await beginActivity(db)).toBeNull();
  sqlite.exec("DELETE FROM active_mutations WHERE id='inflight'");
  expect((await resolve()).status).toBe(200); expect(sqlite.prepare('SELECT COUNT(*) AS n FROM data_deletion_locks').get()?.n).toBe(0);
});
