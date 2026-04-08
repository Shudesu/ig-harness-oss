import { Hono } from 'hono';
import { InstagramClient } from '@ig-harness/ig-sdk';
import type { Env } from '../index.js';

const posts = new Hono<Env>();

posts.get('/api/posts/:id/commenters', async (c) => {
  const mediaId = c.req.param('id');
  const limit = Number(c.req.query('limit') ?? '50');
  const igClient = new InstagramClient({
    accessToken: c.env.IG_ACCESS_TOKEN,
    igUserId: c.env.IG_USER_ID,
  });
  try {
    const comments = await igClient.getMediaComments(mediaId, limit);
    return c.json({ success: true, data: comments });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export { posts };
