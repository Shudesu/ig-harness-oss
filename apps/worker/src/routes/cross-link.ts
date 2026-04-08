import { Hono } from 'hono';
import type { Env } from '../index.js';
import { verifyLinkSecret, linkLineFriend } from '../services/cross-link.js';

const crossLink = new Hono<Env>();

// POST /api/followers/link-line — called from LINE Harness when a friend
// is added via a tracked link carrying ?ig=<IGSID>
crossLink.post('/api/followers/link-line', async (c) => {
  const provided = c.req.header('X-LINE-HARNESS-LINK-SECRET');
  const configured = c.env.LINE_HARNESS_LINK_SECRET ?? '';
  if (!verifyLinkSecret(configured, provided)) {
    return c.json({ success: false, error: 'unauthorized' }, 401);
  }
  let body: { igsid?: string; line_friend_uuid?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }
  if (!body.igsid || !body.line_friend_uuid) {
    return c.json({ success: false, error: 'missing fields' }, 400);
  }
  const ok = await linkLineFriend(c.env.DB, {
    igsid: body.igsid,
    lineFriendUuid: body.line_friend_uuid,
  });
  if (!ok) {
    return c.json({ success: false, error: 'follower not found' }, 404);
  }
  return c.json({ success: true });
});

export { crossLink };
