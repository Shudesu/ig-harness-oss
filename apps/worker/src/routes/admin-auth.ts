import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../index.js';
import { sha256 } from '../lib/security.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import { ADMIN_SESSION_COOKIE, CSRF_COOKIE, SESSION_MAX_AGE, allowedBrowserOrigin, authenticateApiToken, cookie, clearSessionCookies, getAdminSession, randomToken, readCookie, verifySessionCsrf } from '../lib/admin-session.js';
export const adminAuth = new Hono<Env>();
adminAuth.use('/api/auth/*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); await next(); });
adminAuth.post('/api/auth/login', bodyLimit({ maxSize: 8192, onError: c => c.json({ success: false, error: 'Request too large' }, 413) }), async c => {
  if (!allowedBrowserOrigin(c)) return c.json({ success: false, error: 'Admin origin is not allowed' }, 403);
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) return c.json({ success: false, error: config.misconfigured }, 503);
  if (!c.req.header('Content-Type')?.includes('application/json')) return c.json({ success: false, error: 'JSON required' }, 415);
  const text = await c.req.text();
  if (text.length > 8192) return c.json({ success: false, error: 'Request too large' }, 413);
  let apiKey: unknown;
  try { apiKey = JSON.parse(text).apiKey; } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }
  if (typeof apiKey !== 'string' || !apiKey.trim()) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const staff = await authenticateApiToken(c, apiKey);
  if (!staff) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const id = randomToken(), csrfToken = randomToken(), now = Date.now();
  const previous = readCookie(c, ADMIN_SESSION_COOKIE);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM admin_sessions WHERE id_hash=?').bind(await sha256(previous)),
    c.env.DB.prepare('DELETE FROM admin_sessions WHERE id_hash IN (SELECT id_hash FROM admin_sessions WHERE expires_at<=? LIMIT 100)').bind(now),
    c.env.DB.prepare('INSERT INTO admin_sessions(id_hash,staff_id,credential_hash,csrf_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(await sha256(id), staff.id, await sha256(apiKey), await sha256(csrfToken), now, now + SESSION_MAX_AGE * 1000),
    c.env.DB.prepare('DELETE FROM admin_sessions WHERE staff_id=? AND id_hash IN (SELECT id_hash FROM admin_sessions WHERE staff_id=? AND id_hash!=? ORDER BY created_at DESC, id_hash LIMIT -1 OFFSET 19)').bind(staff.id, staff.id, await sha256(id)),
  ]);
  c.header('Set-Cookie', cookie(c, ADMIN_SESSION_COOKIE, id, SESSION_MAX_AGE, true), { append: true });
  c.header('Set-Cookie', cookie(c, CSRF_COOKIE, csrfToken, SESSION_MAX_AGE, false), { append: true });
  return c.json({ success: true, data: { staff, csrfToken } });
});
adminAuth.post('/api/auth/logout', async c => {
  if (!allowedBrowserOrigin(c)) return c.json({ success: false, error: 'Admin origin is not allowed' }, 403);
  const session = await getAdminSession(c);
  if (session && !await verifySessionCsrf(c, session)) return c.json({ success: false, error: 'CSRF token mismatch' }, 403);
  if (session) await c.env.DB.prepare('DELETE FROM admin_sessions WHERE id_hash=?').bind(session.id_hash).run();
  clearSessionCookies(c);
  return c.json({ success: true, data: null });
});
adminAuth.get('/api/auth/session', async c => {
  // A session-bound CSRF value is only returned to the authenticated browser.
  const csrfToken = c.get('csrfToken') ?? null;
  return c.json({ success: true, data: { staff: c.get('staff'), csrfToken } });
});
