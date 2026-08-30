import { Hono } from 'hono';
import {
  createMediaPost,
  listMediaPosts,
  getMediaPostById,
  cancelMediaPost,
  rescheduleMediaPostIfScheduled,
  jstNow,
  toJstString,
  getIgAccountById,
  type MediaPost,
  type MediaPostMediaItem,
  type MediaPostStatus,
  type MediaPostType,
} from '@ig-harness/db';
import { resolveAccount, getAccountClient } from '../lib/accounts.js';
import { kickImmediate } from '../services/media-publish.js';
import type { Env } from '../index.js';

const POST_TYPES: MediaPostType[] = ['feed_image', 'carousel', 'reel', 'story'];
const STATUSES: MediaPostStatus[] = ['scheduled', 'processing', 'published', 'failed', 'canceled'];

function serializeMediaPost(row: MediaPost) {
  let media: MediaPostMediaItem[] = [];
  try {
    media = JSON.parse(row.media) as MediaPostMediaItem[];
  } catch {
    // leave empty on corrupt rows rather than 500ing the whole list
  }
  return {
    id: row.id,
    accountId: row.account_id,
    postType: row.post_type,
    media,
    caption: row.caption,
    status: row.status,
    scheduledAt: row.scheduled_at,
    creationId: row.creation_id,
    publishedMediaId: row.published_media_id,
    attemptCount: row.attempt_count,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * post_type × media integrity. Returns an error message or null when valid.
 * Exported for unit tests.
 */
export function validateMediaPostInput(
  postType: MediaPostType,
  media: MediaPostMediaItem[],
): string | null {
  if (!POST_TYPES.includes(postType)) {
    return `invalid post_type: must be one of ${POST_TYPES.join(', ')}`;
  }
  if (!Array.isArray(media) || media.length === 0) {
    return 'media is required (array of {url, type})';
  }
  for (const item of media) {
    if (!item || typeof item.url !== 'string' || !/^https?:\/\//.test(item.url)) {
      return 'each media item needs a public http(s) URL';
    }
    if (item.type !== 'image' && item.type !== 'video') {
      return "each media item type must be 'image' or 'video'";
    }
  }
  switch (postType) {
    case 'feed_image':
      if (media.length !== 1) return 'feed_image requires exactly 1 media item';
      if (media[0].type !== 'image') return 'feed_image requires an image';
      return null;
    case 'reel':
      if (media.length !== 1) return 'reel requires exactly 1 media item';
      if (media[0].type !== 'video') return 'reel requires a video';
      return null;
    case 'story':
      if (media.length !== 1) return 'story requires exactly 1 media item';
      return null;
    case 'carousel':
      if (media.length < 2 || media.length > 10) {
        return 'carousel requires 2 to 10 media items';
      }
      return null;
  }
}

/**
 * Normalize a client-supplied scheduled_at to a JST (+09:00) string.
 * Offset-less strings (e.g. "2026-07-24T09:00" from datetime-local) are
 * interpreted as JST — this project standardizes on JST everywhere.
 * Returns null for unparseable input.
 */
export function normalizeScheduledAt(input: string): string | null {
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(input);
  const candidate = hasOffset ? input : `${input}+09:00`;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return null;
  return toJstString(date);
}

const mediaPosts = new Hono<Env>();

// NOTE: register before /:id so "publishing-limit" is not captured as an id.
mediaPosts.get('/api/media-posts/publishing-limit', async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  try {
    const igClient = await getAccountClient(c.env, c.env.DB, account);
    const limit = await igClient.getPublishingLimit();
    return c.json({
      success: true,
      data: {
        quotaUsage: limit.quota_usage,
        quotaTotal: limit.config?.quota_total ?? 100,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

mediaPosts.post('/api/media-posts', async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  let body: {
    post_type?: MediaPostType;
    media?: MediaPostMediaItem[];
    caption?: string;
    scheduled_at?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }
  const validationError = validateMediaPostInput(body.post_type as MediaPostType, body.media ?? []);
  if (validationError) return c.json({ success: false, error: validationError }, 400);
  let normalizedScheduledAt: string | null = null;
  if (body.scheduled_at) {
    normalizedScheduledAt = normalizeScheduledAt(body.scheduled_at);
    if (!normalizedScheduledAt) {
      return c.json({ success: false, error: 'scheduled_at must be an ISO 8601 datetime' }, 400);
    }
  }

  const immediate = !body.scheduled_at;
  const post = await createMediaPost(c.env.DB, {
    accountId: account.id,
    postType: body.post_type as MediaPostType,
    media: body.media as MediaPostMediaItem[],
    caption: body.caption ?? null,
    // Normalize to JST (+09:00) — due-check is a SQL string compare, so a
    // client-sent "Z" timestamp must not be stored as-is (see Task 1 note).
    scheduledAt: normalizedScheduledAt ?? jstNow(),
  });

  if (immediate) {
    const igClient = await getAccountClient(c.env, c.env.DB, account);
    c.executionCtx.waitUntil(
      kickImmediate(c.env.DB, igClient, post.id).catch((err) =>
        console.error('[media-posts] kickImmediate failed:', err),
      ),
    );
  }
  return c.json({ success: true, data: serializeMediaPost(post) }, 201);
});

mediaPosts.get('/api/media-posts', async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const statusParam = c.req.query('status') as MediaPostStatus | undefined;
  if (statusParam && !STATUSES.includes(statusParam)) {
    return c.json({ success: false, error: `invalid status: ${statusParam}` }, 400);
  }
  const limit = Number(c.req.query('limit') ?? '50');
  const items = await listMediaPosts(c.env.DB, {
    accountId: account.id,
    status: statusParam,
    limit,
  });
  return c.json({ success: true, data: items.map(serializeMediaPost) });
});

mediaPosts.get('/api/media-posts/:id', async (c) => {
  const post = await getMediaPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: serializeMediaPost(post) });
});

mediaPosts.delete('/api/media-posts/:id', async (c) => {
  const post = await getMediaPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ success: false, error: 'not found' }, 404);
  const canceled = await cancelMediaPost(c.env.DB, post.id);
  if (!canceled) {
    return c.json(
      { success: false, error: `only scheduled posts can be canceled (status=${post.status})` },
      409,
    );
  }
  return c.json({ success: true, data: null });
});

mediaPosts.post('/api/media-posts/:id/publish-now', async (c) => {
  const post = await getMediaPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ success: false, error: 'not found' }, 404);
  if (post.status !== 'scheduled') {
    return c.json(
      { success: false, error: `only scheduled posts can be published now (status=${post.status})` },
      409,
    );
  }
  // The post's owning account must do the publishing — a client built from
  // ?account_id/default could publish this post's media through another
  // account's token when the ids diverge (see broadcasts.ts's /:id/send).
  const account = await getIgAccountById(c.env.DB, post.account_id);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const updated = await rescheduleMediaPostIfScheduled(c.env.DB, post.id, jstNow());
  if (!updated) {
    return c.json(
      { success: false, error: 'post is already being published' },
      409,
    );
  }
  const igClient = await getAccountClient(c.env, c.env.DB, account);
  c.executionCtx.waitUntil(
    kickImmediate(c.env.DB, igClient, post.id).catch((err) =>
      console.error('[media-posts] publish-now kick failed:', err),
    ),
  );
  return c.json({ success: true, data: serializeMediaPost(updated) });
});

export { mediaPosts };
