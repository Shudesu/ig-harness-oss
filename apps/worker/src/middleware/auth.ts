import type { Context, Next } from 'hono';
import type { Env } from '../index.js';
import { constantTimeEqual, sha256 } from '../lib/security.js';
import { allowedBrowserOrigin, authenticateApiToken, CSRF_COOKIE, getAdminSession, readCookie, verifySessionCsrf } from '../lib/admin-session.js';

export function isPublicRequest(path: string, method: string): boolean {
  const read = method === 'GET' || method === 'HEAD';
  if (read && (['/webhook','/privacy','/privacy-policy','/terms-of-service','/data-deletion','/connect','/line','/docs','/openapi.json','/api/affiliates/click'].includes(path)
    || /^\/(?:t|click|images)\//.test(path) || /^\/api\/forms\/[^/]+$/.test(path))) return true;
  return method === 'POST' && (['/webhook','/data-deletion','/api/auth/login','/api/auth/logout','/api/followers/link-line','/api/integrations/stripe/webhook'].includes(path)
    || /^\/api\/webhooks\/incoming\/[^/]+\/receive$/.test(path) || /^\/api\/forms\/[^/]+\/submit$/.test(path));
}
export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Cookie-authenticated API responses must never enter shared/browser caches.
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  if (isPublicRequest(c.req.path, c.req.method)) return next();
  if (c.env.ASSETS && ['GET','HEAD'].includes(c.req.method) && !c.req.path.startsWith('/api/')) return next();
  const header = c.req.header('Authorization');
  if (header !== undefined) {
    if (!header.startsWith('Bearer ')) return c.json({ success: false, error: 'Unauthorized' }, 401);
    const staff = await authenticateApiToken(c, header.slice(7));
    if (!staff) return c.json({ success: false, error: 'Unauthorized' }, 401);
    c.set('staff', staff);
    return next();
  }
  const session = await getAdminSession(c);
  if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401);
  if (!allowedBrowserOrigin(c, false)) return c.json({ success: false, error: 'Admin origin is not allowed' }, 403);
  if (!['GET','HEAD','OPTIONS'].includes(c.req.method) && !await verifySessionCsrf(c, session)) return c.json({ success: false, error: 'CSRF token mismatch' }, 403);
  c.set('staff', session.staff);
  const csrf = readCookie(c, CSRF_COOKIE);
  if (csrf && await constantTimeEqual(await sha256(csrf), session.csrf_hash)) c.set('csrfToken', csrf);
  return next();
}
