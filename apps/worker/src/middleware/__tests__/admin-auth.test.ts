import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../../index.js';
import { authMiddleware, isPublicRequest } from '../auth.js';
import { rateLimitMiddleware, resetRateLimitsForTests } from '../rate-limit.js';
import { resolveAdminAuthConfig, resolveCorsOrigin, isAllowedAdminOrigin, isCrossSite } from '../admin-auth-config.js';
import { adminAuth } from '../../routes/admin-auth.js';
import { testDatabase } from '../../test-utils/d1.js';
import { createStaffMember, regenerateStaffApiKey } from '@ig-harness/db';
import worker from '../../index.js';
const open: Array<{ close(): void }> = [];
beforeEach(() => { resetRateLimitsForTests(); });
afterEach(() => { for (const db of open.splice(0)) db.close(); vi.useRealTimers(); });
async function fixture() {
  const { db, sqlite } = await testDatabase(); open.push(sqlite);
  const env: any = { DB: db, API_KEY: 'owner-secret-test', IG_USER_ID: '', IG_APP_SECRET: 'app-test', WORKER_URL: 'https://worker.workers.dev', ADMIN_ORIGIN: 'https://admin.pages.dev', ADMIN_ALLOW_CROSS_SITE: 'true' };
  const app = new Hono<Env>();
  app.use('*', cors({ origin: (origin,c) => resolveCorsOrigin(c.env,origin,c.req.url), credentials: true }));
  app.use('*', rateLimitMiddleware); app.use('*', authMiddleware); app.route('/', adminAuth);
  app.get('/api/private', c => c.json({ staff: c.get('staff') }));
  app.post('/api/private', c => c.json({ success: true }));
  const request = (path: string, init: RequestInit = {}) => app.fetch(new Request(`https://worker.workers.dev${path}`, init), env);
  const login = async (apiKey = env.API_KEY) => {
    const response = await request('/api/auth/login', { method: 'POST', headers: { Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) });
    const data = await response.clone().json() as any;
    const setCookies = (response.headers as any).getSetCookie() as string[];
    return { response, data, setCookies, cookie: setCookies.map(s => s.split(';')[0]).join('; ') };
  };
  return { db, sqlite, env, app, request, login };
}
it('issues opaque HttpOnly Secure cross-site sessions and stores only their hash', async () => {
  const { login, sqlite } = await fixture(); const auth = await login();
  expect(auth.response.status).toBe(200);
  expect(auth.setCookies[0]).toMatch(/ih_admin_session=[a-f0-9]{64}; Path=\/; Max-Age=604800; SameSite=None; Secure; HttpOnly/);
  expect(auth.cookie).not.toContain('owner-secret-test'); expect(JSON.stringify(auth.data)).not.toContain('owner-secret-test');
  const id = auth.cookie.match(/ih_admin_session=([a-f0-9]+)/)![1];
  const stored = sqlite.prepare('SELECT id_hash,credential_hash FROM admin_sessions').get();
  expect(stored?.id_hash).not.toBe(id); expect(stored?.credential_hash).not.toBe('owner-secret-test');
});
it('uses Lax for same-site custom domains and refuses missing cross-site opt-in', async () => {
  expect(resolveAdminAuthConfig({ WORKER_URL: 'https://api.example.com', ADMIN_ORIGIN: 'https://admin.example.com' }).sameSite).toBe('Lax');
  expect(resolveAdminAuthConfig({ WORKER_URL: 'http://localhost:8787' }, { requestOrigin: 'https://api.example.com' }).secure).toBe(true);
  const { env, login } = await fixture(); delete env.ADMIN_ALLOW_CROSS_SITE;
  const result = await login(); expect(result.response.status).toBe(503); expect(result.setCookies).toHaveLength(0); expect(result.data.error).toContain('ADMIN_ALLOW_CROSS_SITE');
});
it('rejects invalid keys and disallowed or missing login origins', async () => {
  const { login, request } = await fixture(); expect((await login('wrong')).response.status).toBe(401);
  for (const origin of [undefined, 'https://evil.pages.dev']) {
    const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: '{"apiKey":"owner-secret-test"}' });
    expect(response.status).toBe(403); expect(response.headers.get('set-cookie')).toBeNull();
  }
});
it('authenticates cookie reads and requires a session-bound CSRF token for writes', async () => {
  const { login, request } = await fixture(); const auth = await login();
  const headers = { Cookie: auth.cookie, Origin: 'https://admin.pages.dev' };
  const read = await request('/api/private', { headers });
  expect(read.status).toBe(200); expect(read.headers.get('Cache-Control')).toBe('no-store');
  expect((await request('/api/private', { method: 'POST', headers })).status).toBe(403);
  expect((await request('/api/private', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'wrong' } })).status).toBe(403);
  expect((await request('/api/private', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': auth.data.data.csrfToken } })).status).toBe(200);
  const injected = headers.Cookie.replace(/ih_csrf=[^;]+/, 'ih_csrf=attacker');
  expect((await request('/api/private', { method: 'POST', headers: { ...headers, Cookie: injected, 'X-CSRF-Token': 'attacker' } })).status).toBe(403);
});
it('keeps Bearer requests independent of cookie/CSRF and authenticates env owner without D1', async () => {
  const { request, env } = await fixture();
  env.DB = { prepare: () => { throw new Error('D1 must not be accessed'); } };
  expect((await request('/api/private', { method: 'POST', headers: { Authorization: 'Bearer owner-secret-test' } })).status).toBe(200);
  env.API_KEY = '';
  expect((await request('/api/private', { headers: { Authorization: 'Bearer ' } })).status).toBe(401);
});
it('rejects malformed, expired and duplicate session cookies without crashing', async () => {
  const { request, login, sqlite } = await fixture(); const auth = await login();
  for (const cookie of ['ih_admin_session=%E0%A4%A', 'ih_admin_session=', `${auth.cookie}; ${auth.cookie}`]) expect((await request('/api/private', { headers: { Cookie: cookie } })).status).toBe(401);
  sqlite.exec('UPDATE admin_sessions SET expires_at=0'); expect((await request('/api/private', { headers: { Cookie: auth.cookie } })).status).toBe(401);
});
it('returns staff and CSRF for a valid session and revokes it on logout', async () => {
  const { request, login } = await fixture(); const auth = await login();
  const headers = { Cookie: auth.cookie, Origin: 'https://admin.pages.dev', 'X-CSRF-Token': auth.data.data.csrfToken };
  const session = await (await request('/api/auth/session', { headers })).json() as any;
  expect(session.data.staff.role).toBe('owner'); expect(session.data.csrfToken).toBe(auth.data.data.csrfToken);
  expect((await request('/api/auth/logout', { method: 'POST', headers: { Cookie: auth.cookie, Origin: 'https://admin.pages.dev' } })).status).toBe(403);
  const out = await request('/api/auth/logout', { method: 'POST', headers }); expect(out.status).toBe(200); expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
  expect((await request('/api/private', { headers })).status).toBe(401);
});
it('invalidates sessions after key rotation and reads staff role changes immediately', async () => {
  const { request, login, db, sqlite, env } = await fixture();
  const owner = await login(); env.API_KEY = 'rotated-owner'; expect((await request('/api/private', { headers: { Cookie: owner.cookie } })).status).toBe(401);
  const staff = await createStaffMember(db, { name: 'Admin', role: 'admin' }); const auth = await login(staff.api_key);
  sqlite.prepare("UPDATE staff_members SET role='staff' WHERE id=?").run(staff.id);
  expect((await (await request('/api/private', { headers: { Cookie: auth.cookie } })).json() as any).staff.role).toBe('staff');
  await regenerateStaffApiKey(db, staff.id); expect((await request('/api/private', { headers: { Cookie: auth.cookie } })).status).toBe(401);
});
it('limits login by IP and cookie requests by credential', async () => {
  const { request } = await fixture();
  for (let i=0;i<10;i++) expect((await request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  expect((await request('/api/auth/login', { method: 'POST' })).status).toBe(429);
  resetRateLimitsForTests();
  const app = new Hono<Env>(); app.use('*', rateLimitMiddleware); app.get('/api/private', c => c.text('ok'));
  for (let i=0;i<1000;i++) expect((await app.request('https://worker.example/api/private', { headers: { Cookie: 'ih_admin_session=test-session' } })).status).toBe(200);
  expect((await app.request('https://worker.example/api/private', { headers: { Cookie: 'ih_admin_session=test-session', 'cf-connecting-ip': '192.0.2.2' } })).status).toBe(429);
});
it('only permits the same Pages project previews and enforces method-specific public paths', async () => {
  expect(isAllowedAdminOrigin('https://preview.admin.pages.dev','https://admin.pages.dev')).toBe(true);
  expect(isAllowedAdminOrigin('https://other.pages.dev','https://admin.pages.dev')).toBe(false);
  expect(isAllowedAdminOrigin('https://preview.admin.pages.dev:444','https://admin.pages.dev')).toBe(false);
  expect(isCrossSite('https://admin.pages.dev','https://api.workers.dev')).toBe(true);
  expect(resolveCorsOrigin({}, 'http://localhost:3001','https://api.example')).toBe('');
  expect(isPublicRequest('/api/forms/1','GET')).toBe(true); expect(isPublicRequest('/api/forms/1','DELETE')).toBe(false);
  expect(isPublicRequest('/api/auth/login','POST')).toBe(true); expect(isPublicRequest('/api/auth/login','GET')).toBe(false);
});
it('applies credentialed CORS in the real application while preserving origin-less Bearer requests', async () => {
  const { env } = await fixture(); const ctx: any = { waitUntil: () => {}, passThroughOnException() {} };
  const options = (origin: string) => worker.fetch(new Request('https://worker.workers.dev/api/staff/me', { method:'OPTIONS', headers:{ Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'X-CSRF-Token' } }),env,ctx);
  const allowed = await options('https://preview.admin.pages.dev'); expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.admin.pages.dev'); expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  expect((await options('https://other.pages.dev')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  const native = await worker.fetch(new Request('https://worker.workers.dev/api/health', { headers: { Authorization: 'Bearer owner-secret-test' } }),env,ctx); expect(native.status).toBe(200);
});

it('enforces the IP ceiling even when credentials rotate on every request', async () => {
  const app = new Hono<Env>(); app.use('*', rateLimitMiddleware); app.get('/api/private', c => c.text('ok'));
  for (let i=0;i<3000;i++) expect((await app.request('https://worker.example/api/private', { headers: { Cookie: `ih_admin_session=rotating-${i}`, 'cf-connecting-ip': '192.0.2.3' } })).status).toBe(200);
  expect((await app.request('https://worker.example/api/private', { headers: { Cookie: 'ih_admin_session=another', 'cf-connecting-ip': '192.0.2.3' } })).status).toBe(429);
});
it('creates a tracked link through cookie/CSRF auth and safely redirects using the real schema', async () => {
  const { env, sqlite, login } = await fixture(); const auth = await login();
  sqlite.exec("INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','123','test',1,'2026-01-01','2026-01-01'); INSERT INTO integration_settings(key,value) VALUES('account_backfill_done','1')");
  const pending: Promise<unknown>[] = []; const context: any = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException() {} };
  const url = 'https://github.com/repo?q=</script><script>bad()</script>';
  const created = await worker.fetch(new Request('https://worker.workers.dev/api/tracked-links', { method:'POST', headers:{ Cookie:auth.cookie, Origin:env.ADMIN_ORIGIN, 'X-CSRF-Token':auth.data.data.csrfToken, 'Content-Type':'application/json' }, body:JSON.stringify({ name:'Safe redirect',originalUrl:url }) }),env,context);
  expect(created.status).toBe(201); const body = await created.json() as any;
  const redirect = await worker.fetch(new Request(body.data.trackingUrl),env,context);
  expect(redirect.status).toBe(200); expect(await redirect.text()).not.toContain('</script><script>');
  await Promise.all(pending); expect(sqlite.prepare('SELECT click_count FROM tracked_links').get()?.click_count).toBe(1);
});
it('sandboxes legacy uploaded HTML responses on the session origin', async () => {
  const { env } = await fixture(); const payload = '<script>bad()</script>';
  env.IMAGES = { get: async () => ({ body: payload, httpMetadata: { contentType: 'text/html' }, size: payload.length, etag: 'test' }) };
  const response = await worker.fetch(new Request('https://worker.workers.dev/images/legacy.html'), env, { waitUntil() {}, passThroughOnException() {} } as any);
  expect(response.status).toBe(200); expect(response.headers.get('Content-Security-Policy')).toContain('sandbox'); expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
});

it('stops reading an oversized streaming login before parsing or persisting a session', async () => {
  const { app, env, sqlite } = await fixture(); let pulls = 0;
  const stream = new ReadableStream({ pull(controller) { if (++pulls <= 100) controller.enqueue(new Uint8Array(4096)); else controller.close(); } });
  const response = await app.fetch(new Request('https://worker.workers.dev/api/auth/login', { method:'POST', headers:{ Origin:env.ADMIN_ORIGIN, 'Content-Type':'application/json' }, body:stream, duplex:'half' } as any), env);
  expect(response.status).toBe(413); expect(pulls).toBeLessThan(10);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get()?.n).toBe(0);
});
