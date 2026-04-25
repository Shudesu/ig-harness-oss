import { Hono } from 'hono';
import { InstagramClient } from '@ig-harness/ig-sdk';
import {
  listEngagementGates,
  createEngagementGate,
  getRichMessage,
  hasCheckFollowPostback,
} from '@ig-harness/db';
import { getIGAccessToken } from '../lib/ig-token.js';
import type { Env } from '../index.js';

const posts = new Hono<Env>();

posts.get('/api/posts/:id/commenters', async (c) => {
  const mediaId = c.req.param('id');
  const limit = Number(c.req.query('limit') ?? '50');
  const igClient = new InstagramClient({
    accessToken: await getIGAccessToken(c.env),
    igUserId: c.env.IG_USER_ID,
  });
  try {
    const comments = await igClient.getMediaComments(mediaId, limit);
    return c.json({ success: true, data: comments });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

/**
 * GET /api/posts/my-reels?limit=50
 *
 * Returns the authenticated account's reels (media_product_type === 'REELS').
 * Used by MCP list_recent_reels and bulk_apply_gates_to_reels.
 */
posts.get('/api/posts/my-reels', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '50'), 1), 100);
  const igClient = new InstagramClient({
    accessToken: await getIGAccessToken(c.env),
    igUserId: c.env.IG_USER_ID,
  });
  try {
    // `limit` applies BEFORE filtering at the Graph API side, so feed posts
    // can crowd out reels. Fetch the max page (100) and filter locally, then
    // slice to the requested limit.
    const media = await igClient.getMyMedia(100);
    const reels = media
      .filter((m) => m.media_product_type === 'REELS')
      .slice(0, limit);
    return c.json({ success: true, data: reels });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

/**
 * GET /api/posts/my-media?product_type=REELS|FEED|all&limit=100
 *
 * Returns all of the authenticated account's media, optionally filtered by
 * media_product_type. Used by the admin UI to let operators pick a post
 * (reel / feed post / carousel) as a target for comment rules and gates.
 */
posts.get('/api/posts/my-media', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 100);
  const productType = (c.req.query('product_type') ?? 'all').toUpperCase();
  const igClient = new InstagramClient({
    accessToken: await getIGAccessToken(c.env),
    igUserId: c.env.IG_USER_ID,
  });
  try {
    const media = await igClient.getMyMedia(limit);
    const filtered =
      productType === 'ALL'
        ? media
        : media.filter((m) => m.media_product_type === productType);
    return c.json({ success: true, data: filtered });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

/**
 * POST /api/posts/bulk-apply-gates
 *
 * Creates one engagement gate per reel_id using shared rich-message IDs.
 * Skips reels that already have a non-archived gate on them.
 *
 * Body:
 *   reel_ids: string[] (required, ≤100)
 *   name_prefix: string (required)
 *   trigger_keyword?: string | null  -- null = any_comment mode
 *   require_follow: boolean (default true)
 *   initial_dm_rich_message_id: string (required)
 *   reward_dm_rich_message_id: string (required)
 *   follow_reminder_dm_rich_message_id?: string
 *   reward_url?: string
 *   max_loops?: number (default 3)
 */
posts.post('/api/posts/bulk-apply-gates', async (c) => {
  const body = await c.req.json<{
    reel_ids?: string[];
    name_prefix?: string;
    trigger_keyword?: string | null;
    require_follow?: boolean;
    initial_dm_rich_message_id?: string;
    reward_dm_rich_message_id?: string;
    follow_reminder_dm_rich_message_id?: string;
    reward_url?: string;
    max_loops?: number;
  }>();

  if (!body.reel_ids || !Array.isArray(body.reel_ids) || body.reel_ids.length === 0) {
    return c.json({ success: false, error: 'reel_ids required (non-empty array)' }, 400);
  }
  if (body.reel_ids.length > 100) {
    return c.json({ success: false, error: 'reel_ids capped at 100 per call' }, 400);
  }
  if (!body.name_prefix) {
    return c.json({ success: false, error: 'name_prefix required' }, 400);
  }
  if (!body.initial_dm_rich_message_id || !body.reward_dm_rich_message_id) {
    return c.json(
      { success: false, error: 'initial_dm_rich_message_id and reward_dm_rich_message_id required' },
      400,
    );
  }

  const requireFollow = body.require_follow === false ? 0 : 1;

  // When follow verification is enabled, a reminder DM is part of the loop.
  // Without a reminder template, non-followers would receive an empty DM.
  if (requireFollow === 1 && !body.follow_reminder_dm_rich_message_id) {
    return c.json(
      {
        success: false,
        error:
          'follow_reminder_dm_rich_message_id required when require_follow is true (non-followers receive the reminder DM)',
      },
      400,
    );
  }

  // Verify referenced rich messages exist before spending a reel's slot.
  const [initialRm, rewardRm] = await Promise.all([
    getRichMessage(c.env.DB, body.initial_dm_rich_message_id),
    getRichMessage(c.env.DB, body.reward_dm_rich_message_id),
  ]);
  if (!initialRm) return c.json({ success: false, error: 'initial_dm_rich_message_id not found' }, 400);
  if (!rewardRm) return c.json({ success: false, error: 'reward_dm_rich_message_id not found' }, 400);

  if (body.follow_reminder_dm_rich_message_id) {
    const reminderRm = await getRichMessage(c.env.DB, body.follow_reminder_dm_rich_message_id);
    if (!reminderRm) {
      return c.json({ success: false, error: 'follow_reminder_dm_rich_message_id not found' }, 400);
    }
  }

  // CTA always needs a CHECK_FOLLOW postback — the reward delivery path runs
  // exclusively through handleFollowCheckPostback, independent of require_follow.
  if (!hasCheckFollowPostback(initialRm.blocks)) {
    return c.json(
      {
        success: false,
        error:
          'initial_dm_rich_message_id must contain a postback button with payload "CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}" — without it, deliveries stall in cta_sent',
      },
      400,
    );
  }
  // Reminder is only sent in the require_follow=1 loop.
  if (requireFollow === 1 && body.follow_reminder_dm_rich_message_id) {
    const reminderRm = await getRichMessage(c.env.DB, body.follow_reminder_dm_rich_message_id);
    if (reminderRm && !hasCheckFollowPostback(reminderRm.blocks)) {
      return c.json(
        {
          success: false,
          error:
            'follow_reminder_dm_rich_message_id must contain a postback button with payload "CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}" when require_follow=true',
        },
        400,
      );
    }
  }

  // Existing non-archived gates keyed by target_post_id.
  const existingGates = await listEngagementGates(c.env.DB);
  const existingByPost = new Set(
    existingGates
      .filter((g) => g.status !== 'archived' && g.target_post_id)
      .map((g) => g.target_post_id!),
  );

  const created: Array<{ id: string; reel_id: string; status: 'created' | 'skipped' }> = [];
  const seenInRequest = new Set<string>();

  for (const reelId of body.reel_ids) {
    if (existingByPost.has(reelId) || seenInRequest.has(reelId)) {
      created.push({ id: '', reel_id: reelId, status: 'skipped' });
      continue;
    }
    seenInRequest.add(reelId);
    const gate = await createEngagementGate(c.env.DB, {
      name: `${body.name_prefix}-${reelId.slice(-8)}`,
      status: 'active',
      trigger_type: 'comment_on_post',
      target_post_id: reelId,
      trigger_keyword: body.trigger_keyword ?? null,
      require_follow: requireFollow,
      initial_dm_text: '',
      initial_dm_button_label: '特典を受け取る',
      follow_reminder_dm_text: '',
      follow_reminder_button_label: 'フォローしたよ',
      reward_dm_text: '',
      reward_url: body.reward_url ?? null,
      max_loops: body.max_loops ?? 3,
      initial_dm_rich_message_id: body.initial_dm_rich_message_id,
      reward_dm_rich_message_id: body.reward_dm_rich_message_id,
      follow_reminder_dm_rich_message_id: body.follow_reminder_dm_rich_message_id ?? null,
      comment_reply_text: null,
      followup_dm_sequence: null,
      line_connection_id: null,
      line_pool_slug: null,
      line_tracked_link_short: null,
    });
    created.push({ id: gate.id, reel_id: reelId, status: 'created' });
  }

  return c.json({
    success: true,
    data: {
      created: created.filter((x) => x.status === 'created').length,
      skipped: created.filter((x) => x.status === 'skipped').length,
      gates: created,
    },
  });
});

export { posts };
