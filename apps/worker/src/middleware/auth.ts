import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@ig-harness/db';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the Instagram webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  if (
    path === '/webhook' ||
    path === '/privacy' ||
    path === '/privacy-policy' ||
    path === '/terms-of-service' ||
    path === '/data-deletion' ||
    path === '/connect' ||
    path === '/line' ||
    path === '/api/followers/link-line' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/click/') ||
    path.startsWith('/images/') ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+$/)
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // Check env API_KEY first — it needs no DB round-trip, so the health
  // monitor can still authenticate while D1 is down (and report db_ok=false).
  if (token === c.env.API_KEY) {
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    return next();
  }

  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    c.set('staff', { id: staff.id, name: staff.name, role: staff.role });
    return next();
  }

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}
