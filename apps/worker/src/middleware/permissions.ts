import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

// Public endpoints have no staff context and enforce their own signed request /
// form checks. Authenticated staff are read-only; tagging can also trigger automations.
export async function permissionMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const staff = c.get('staff');
  if (!staff || staff.role === 'owner') return next();
  const path = new URL(c.req.url).pathname;
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
  const ownerOnly = /^\/api\/(?:integrations|line-connections|data-deletion)(?:\/|$)/.test(path)
    || /^\/api\/accounts\/[^/]+\/migrate$/.test(path)
    || path.startsWith('/api/internal/');
  if (ownerOnly) return c.json({ success: false, error: 'Owner permission required' }, 403);
  if (staff.role === 'admin' || read) return next();
  return c.json({ success: false, error: 'Admin permission required' }, 403);
}
