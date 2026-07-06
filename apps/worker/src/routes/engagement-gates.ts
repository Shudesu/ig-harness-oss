import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  createEngagementGate,
  listEngagementGates,
  getEngagementGate,
  updateEngagementGate,
  deleteEngagementGate,
  listGateDeliveries,
  getGateAnalytics,
  getRichMessage,
  hasCheckFollowPostback,
  setGateTargetPosts,
} from '@ig-harness/db';
import { resolveAccount } from '../lib/accounts.js';

const engagementGates = new Hono<Env>();

/**
 * GET /click/:gateId?u=<base64url-encoded destination>[&ig=<igsid>]
 *
 * Records a click and 302s to the decoded destination.
 *
 * SECURITY: the destination's ORIGIN (protocol + host) must match one of
 * the operator-configured allowed origins:
 *   1. The gate's reward_url origin  (always checked)
 *   2. The gate's LINE connection worker_url origin (when line_connection_id is set)
 * Any other host → 400, preventing open-redirect abuse.
 */
engagementGates.get('/click/:gateId', async (c) => {
  const gateId = c.req.param('gateId');
  const uEncoded = c.req.query('u') ?? '';
  const igsid = c.req.query('ig') ?? null;
  const ua = c.req.header('User-Agent') ?? null;
  const referer = c.req.header('Referer') ?? null;

  let destination = '';
  try {
    destination = decodeBase64Url(uEncoded);
  } catch {
    return c.text('Invalid destination', 400);
  }
  if (!destination || !/^https?:\/\//.test(destination)) {
    return c.text('Invalid destination', 400);
  }

  // Load gate to validate the destination origin.
  const gate = await getEngagementGate(c.env.DB, gateId);
  if (!gate) {
    return c.text('Invalid destination', 400);
  }

  let destOrigin: string;
  try {
    destOrigin = new URL(destination).origin;
  } catch {
    return c.text('Invalid destination', 400);
  }

  // Build the set of allowed origins from operator-configured values.
  const allowedOrigins = new Set<string>();
  if (gate.reward_url) {
    try { allowedOrigins.add(new URL(gate.reward_url).origin); } catch { /* ignore malformed */ }
  }
  if (gate.line_connection_id) {
    try {
      const conn = await c.env.DB
        .prepare('SELECT worker_url FROM line_harness_connections WHERE id = ?')
        .bind(gate.line_connection_id)
        .first<{ worker_url: string }>();
      if (conn?.worker_url) {
        allowedOrigins.add(new URL(conn.worker_url).origin);
      }
    } catch { /* ignore DB/parse errors */ }
  }

  if (!allowedOrigins.has(destOrigin)) {
    console.warn(`[gate-click] blocked redirect to disallowed origin: ${destOrigin}`);
    return c.text('Invalid destination', 400);
  }

  const id = crypto.randomUUID();
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await c.env.DB
          .prepare(
            `INSERT INTO gate_clicks (id, gate_id, igsid, destination_url, user_agent, referer)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, gateId, igsid, destination, ua, referer)
          .run();
      } catch (err) {
        console.error('[gate-click] insert failed:', err);
      }
    })(),
  );

  return c.redirect(destination, 302);
});

/**
 * base64url decode (no padding, - _ instead of + /). Worker's atob only
 * handles standard base64, so we normalize first.
 */
function decodeBase64Url(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return decodeURIComponent(
    atob(b64)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  );
}

engagementGates.get('/api/engagement-gates', async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const gates = await listEngagementGates(c.env.DB, { accountId: account.id });
  return c.json({ success: true, data: gates });
});

/**
 * GET /api/engagement-gates/post-coverage
 *
 * Returns a map of { post_id: [{gate_id, gate_name, status}, ...] } so the
 * wizard's media picker can surface "N キャンペーン適用中" badges and stop
 * operators from accidentally double-binding the same post.
 */
engagementGates.get('/api/engagement-gates/post-coverage', async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT gtp.post_id, g.id AS gate_id, g.name AS gate_name, g.status AS gate_status
       FROM gate_target_posts gtp
       JOIN engagement_gates g ON g.id = gtp.gate_id
       WHERE g.status != 'archived'`,
    )
    .all<{ post_id: string; gate_id: string; gate_name: string; gate_status: string }>();

  const map: Record<string, Array<{ gate_id: string; gate_name: string; status: string }>> = {};
  for (const r of rows.results) {
    const arr = map[r.post_id] ?? [];
    arr.push({ gate_id: r.gate_id, gate_name: r.gate_name, status: r.gate_status });
    map[r.post_id] = arr;
  }
  return c.json({ success: true, data: map });
});

engagementGates.post('/api/engagement-gates', async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const body = await c.req.json<{
    name: string;
    status?: 'active' | 'paused' | 'archived';
    trigger_type: 'comment_on_post' | 'dm_keyword' | 'story_mention';
    target_post_id?: string | null;
    trigger_keyword?: string | null;
    require_follow?: number;
    initial_dm_text?: string;
    initial_dm_button_label?: string;
    follow_reminder_dm_text?: string;
    follow_reminder_button_label?: string;
    reward_dm_text?: string;
    reward_url?: string | null;
    max_loops?: number;
    initial_dm_rich_message_id?: string | null;
    reward_dm_rich_message_id?: string | null;
    follow_reminder_dm_rich_message_id?: string | null;
    comment_reply_text?: string | null;
    followup_dm_sequence?: string | null;
    /** When 1, every matching trigger creates a new delivery and the
     *  service skips the idempotent early-return so the same follower
     *  can run the CTA flow repeatedly (demo/nurture campaigns).
     *  Default 0 (legacy idempotent: 1 follower × 1 gate = 1 delivery). */
    allow_repeat?: number;
    /** LINE Harness cross-link binding. When both are set, reward / CTA
     *  DMs rewrite outbound URLs through a LINE Harness tracked link so
     *  first-click captures the IG↔LINE userId pair. */
    line_connection_id?: string | null;
    line_pool_slug?: string | null;
    /** New preferred way: N target posts. Empty = all posts. Takes precedence
     *  over legacy target_post_id when present. */
    target_post_ids?: string[];
  }>();

  if (!body.name || !body.trigger_type) {
    return c.json({ success: false, error: 'missing required fields: name, trigger_type' }, 400);
  }

  // Legacy text fields are only required when the corresponding rich-message
  // slot is NOT provided. Missing legacy text + missing rich_message_id =
  // invalid configuration.
  const initialOk = !!body.initial_dm_text || !!body.initial_dm_rich_message_id;
  const reminderOk = !!body.follow_reminder_dm_text || !!body.follow_reminder_dm_rich_message_id;
  const rewardOk = !!body.reward_dm_text || !!body.reward_dm_rich_message_id;
  if (!initialOk || !reminderOk || !rewardOk) {
    return c.json(
      { success: false, error: 'each DM slot needs either legacy *_dm_text or *_rich_message_id' },
      400,
    );
  }

  // Fail fast on typo'd references — the legacy *_dm_text columns default
  // to '' when a rich_message_id is set, so a missing row would otherwise
  // cause silent empty-DM delivery at runtime.
  const requireFollow = body.require_follow ?? 1;
  // CTA (initial) always needs CHECK_FOLLOW postback — it's the only path
  // that advances to reward delivery, regardless of require_follow.
  // Reminder needs CHECK_FOLLOW only when require_follow=1 (it only runs in
  // that flow).
  for (const [field, id, enforceCheckFollow] of [
    ['initial_dm_rich_message_id', body.initial_dm_rich_message_id, true],
    ['reward_dm_rich_message_id', body.reward_dm_rich_message_id, false],
    ['follow_reminder_dm_rich_message_id', body.follow_reminder_dm_rich_message_id, requireFollow === 1],
  ] as const) {
    if (id) {
      const rm = await getRichMessage(c.env.DB, id);
      if (!rm) return c.json({ success: false, error: `${field} not found: ${id}` }, 400);
      if (enforceCheckFollow && !hasCheckFollowPostback(rm.blocks)) {
        return c.json(
          {
            success: false,
            error: `${field} must contain a postback button with payload "CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}" — without it, deliveries stall in cta_sent`,
          },
          400,
        );
      }
    }
  }

  // Normalize: junction array wins when provided. The legacy single-post
  // column stays in sync for back-compat (holds the first id, or null).
  const targetIds = Array.isArray(body.target_post_ids)
    ? body.target_post_ids.filter((x) => typeof x === 'string' && x.length > 0)
    : body.target_post_id
      ? [body.target_post_id]
      : [];
  const legacyTargetPostId = targetIds.length > 0 ? targetIds[0]! : null;

  const gate = await createEngagementGate(c.env.DB, {
    name: body.name,
    status: body.status ?? 'active',
    trigger_type: body.trigger_type,
    target_post_id: legacyTargetPostId,
    trigger_keyword: body.trigger_keyword ?? null,
    require_follow: body.require_follow ?? 1,
    initial_dm_text: body.initial_dm_text ?? '',
    initial_dm_button_label: body.initial_dm_button_label ?? '特典を受け取る',
    follow_reminder_dm_text: body.follow_reminder_dm_text ?? '',
    follow_reminder_button_label: body.follow_reminder_button_label ?? 'フォローしたよ',
    reward_dm_text: body.reward_dm_text ?? '',
    reward_url: body.reward_url ?? null,
    max_loops: body.max_loops ?? 0,
    initial_dm_rich_message_id: body.initial_dm_rich_message_id ?? null,
    reward_dm_rich_message_id: body.reward_dm_rich_message_id ?? null,
    follow_reminder_dm_rich_message_id: body.follow_reminder_dm_rich_message_id ?? null,
    comment_reply_text: body.comment_reply_text ?? null,
    followup_dm_sequence: body.followup_dm_sequence ?? null,
    line_connection_id: body.line_connection_id ?? null,
    line_pool_slug: body.line_pool_slug ?? null,
    line_tracked_link_short: null,
    allow_repeat: body.allow_repeat ?? 0,
    accountId: account.id,
  });

  // Populate the junction table with the full id list.
  await setGateTargetPosts(c.env.DB, gate.id, targetIds);
  gate.target_post_ids = targetIds;

  return c.json({ success: true, data: gate });
});

engagementGates.get('/api/engagement-gates/:id', async (c) => {
  const id = c.req.param('id');
  const gate = await getEngagementGate(c.env.DB, id);
  if (!gate) return c.json({ success: false, error: 'not found' }, 404);
  const analytics = await getGateAnalytics(c.env.DB, id);
  return c.json({ success: true, data: { ...gate, analytics } });
});

engagementGates.patch('/api/engagement-gates/:id', async (c) => {
  const id = c.req.param('id');
  const patch = await c.req.json<Record<string, unknown>>();

  const existing = await getEngagementGate(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: 'not found' }, 404);

  // Invalidate the cached tracked-link id when any of the three fields
  // that bake into the tracked link change: connection, pool, or reward_url.
  // Without this, edits would keep routing clicks through a stale LINE
  // Harness tracked link whose originalUrl no longer matches the operator's
  // intent (wrong pool attribution or wrong redirect target).
  const nextConn = 'line_connection_id' in patch ? patch.line_connection_id : existing.line_connection_id;
  const nextPool = 'line_pool_slug' in patch ? patch.line_pool_slug : existing.line_pool_slug;
  const nextUrl = 'reward_url' in patch ? patch.reward_url : existing.reward_url;
  const invalidate =
    nextConn !== existing.line_connection_id ||
    nextPool !== existing.line_pool_slug ||
    nextUrl !== existing.reward_url;
  if (invalidate) {
    patch.line_tracked_link_short = null;
  }

  // Apply target_post_ids update if present. Strip it from `patch` before
  // passing to updateEngagementGate so the column whitelist doesn't reject.
  if (Array.isArray(patch.target_post_ids)) {
    const ids = (patch.target_post_ids as unknown[]).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    await setGateTargetPosts(c.env.DB, id, ids);
    // Keep legacy column in sync
    patch.target_post_id = ids.length > 0 ? ids[0] : null;
    delete patch.target_post_ids;
  }

  // Simulate the merged row so we can validate the effective post-patch
  // configuration the same way POST validates a fresh gate.
  const pick = <K extends keyof typeof existing>(key: K): typeof existing[K] =>
    key in patch ? (patch[key as string] as typeof existing[K]) : existing[key];
  const merged = {
    require_follow: pick('require_follow'),
    initial_dm_text: pick('initial_dm_text'),
    follow_reminder_dm_text: pick('follow_reminder_dm_text'),
    reward_dm_text: pick('reward_dm_text'),
    initial_dm_rich_message_id: pick('initial_dm_rich_message_id'),
    reward_dm_rich_message_id: pick('reward_dm_rich_message_id'),
    follow_reminder_dm_rich_message_id: pick('follow_reminder_dm_rich_message_id'),
  };

  const initialOk = !!merged.initial_dm_text || !!merged.initial_dm_rich_message_id;
  const reminderOk = !!merged.follow_reminder_dm_text || !!merged.follow_reminder_dm_rich_message_id;
  const rewardOk = !!merged.reward_dm_text || !!merged.reward_dm_rich_message_id;
  if (!initialOk || !reminderOk || !rewardOk) {
    return c.json(
      { success: false, error: 'merged gate has a DM slot with neither legacy *_dm_text nor *_rich_message_id' },
      400,
    );
  }

  // Validate each rich-message reference that ends up on the merged row.
  for (const [field, enforceCheckFollow] of [
    ['initial_dm_rich_message_id', true],
    ['reward_dm_rich_message_id', false],
    ['follow_reminder_dm_rich_message_id', merged.require_follow === 1],
  ] as const) {
    const value = merged[field];
    if (typeof value === 'string' && value.length > 0) {
      const rm = await getRichMessage(c.env.DB, value);
      if (!rm) return c.json({ success: false, error: `${field} not found: ${value}` }, 400);
      if (enforceCheckFollow && !hasCheckFollowPostback(rm.blocks)) {
        return c.json(
          {
            success: false,
            error: `${field} must contain a postback button with payload "CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}"`,
          },
          400,
        );
      }
    }
  }

  await updateEngagementGate(c.env.DB, id, patch);
  const gate = await getEngagementGate(c.env.DB, id);
  return c.json({ success: true, data: gate });
});

engagementGates.delete('/api/engagement-gates/:id', async (c) => {
  const id = c.req.param('id');
  await deleteEngagementGate(c.env.DB, id);
  return c.json({ success: true });
});

engagementGates.get('/api/engagement-gates/:id/deliveries', async (c) => {
  const id = c.req.param('id');
  const deliveries = await listGateDeliveries(c.env.DB, id);
  return c.json({ success: true, data: deliveries });
});

export { engagementGates };
