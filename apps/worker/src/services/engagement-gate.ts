import { listEngagementGates, createGateDelivery, updateGateDelivery, getGateDelivery, getEngagementGate, getRichMessage, parseFollowupSequence, logMessage } from '@ig-harness/db';
import type { EngagementGate, GateDelivery } from '@ig-harness/db';
import type { UserProfile, RichMessageBlock, RichMessageContext } from '@ig-harness/ig-sdk';
import { resolveLineCrossLinkUrl, type IgAccountRef } from './line-cross-link.js';
import { recordDmFailure } from '../lib/health.js';

/**
 * Compute the outbound reward URL for one recipient, optionally rewritten
 * through a LINE Harness tracked link so IG↔LINE cross-link is captured.
 * When the gate has no line_connection_id, returns `gate.reward_url` as-is.
 * When the LINE Harness call fails, logs and falls back to the raw URL so
 * delivery is never blocked by a transient LINE-side issue.
 */
async function effectiveRewardUrl(
  db: D1Database,
  gate: EngagementGate,
  igsid: string,
  igAccount?: IgAccountRef,
): Promise<string | null> {
  const crossLink = await resolveLineCrossLinkUrl(db, gate, igsid, { account: igAccount });
  return crossLink ?? gate.reward_url;
}

/**
 * Build a click-tracking URL that records the tap in gate_clicks before
 * 302'ing to the real destination. `workerBaseUrl` is the public origin
 * of this worker (e.g. `https://ig-harness.noda-c40.workers.dev`); we get
 * it from env.WORKER_URL so the link works off the correct deployment.
 */
export function wrapClickTracking(
  workerBaseUrl: string,
  gateId: string,
  destinationUrl: string,
  igsid?: string,
): string {
  if (!destinationUrl || !/^https?:\/\//.test(destinationUrl)) return destinationUrl;
  // base64url encode the destination so it survives in a query param
  const b64 = btoa(encodeURIComponent(destinationUrl).replace(/%([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  ))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const base = workerBaseUrl.replace(/\/$/, '');
  const igPart = igsid ? `&ig=${encodeURIComponent(igsid)}` : '';
  return `${base}/click/${gateId}?u=${b64}${igPart}`;
}

interface IgClientLike {
  sendGenericTemplate(recipientId: string, elements: unknown[]): Promise<unknown>;
  sendQuickReply(recipientId: string, text: string, items: unknown[]): Promise<unknown>;
  sendText(recipientId: string, text: string): Promise<unknown>;
  sendImage(recipientId: string, imageUrl: string): Promise<unknown>;
  sendRichMessage(
    recipientId: string,
    blocks: RichMessageBlock[],
    context?: RichMessageContext,
  ): Promise<{ sentBlocks: number }>;
  getUserProfile(igsid: string): Promise<UserProfile>;
  replyToComment(commentId: string, message: string): Promise<unknown>;
  postCommentToMedia(mediaId: string, message: string): Promise<unknown>;
}

interface FollowerRef {
  id: number;
  igsid: string;
}

export async function triggerGateForComment(
  db: D1Database,
  igClient: IgClientLike,
  args: {
    postId: string;
    commentText: string;
    follower: FollowerRef;
    /** Instagram comment id. Used to post a public reply when the matching
     *  gate has comment_reply_text configured. */
    commentId?: string;
    /** @username of the commenter, for {{username}} placeholder expansion. */
    commenterUsername?: string;
    /** Public worker origin (e.g. https://ig-harness.noda-c40.workers.dev).
     *  Required for reward-URL click tracking. When omitted we fall through
     *  to the raw destination URL. */
    workerBaseUrl?: string;
    /** Which IG business account fired this gate — forwarded to LINE Harness
     *  via iga/igan params so the friend's origin account is attributable. */
    igAccount?: IgAccountRef;
    /** Owning account row id (ig_accounts.id) — scopes gate matching. */
    accountId?: string;
  },
): Promise<boolean> {
  const all = await listEngagementGates(db, { activeOnly: true, accountId: args.accountId });

  // Score + filter candidates so a post-specific campaign always beats a
  // "全投稿" fallback, regardless of creation order. Precedence:
  //   ① scoped (includes this post) + keyword match   [3]
  //   ② scoped (includes this post) + no keyword      [2]
  //   ③ unscoped + keyword match                      [1]
  //   ④ unscoped + no keyword (catch-all fallback)    [0]
  interface Scored { gate: typeof all[number]; score: number }
  const candidates: Scored[] = [];
  for (const gate of all) {
    if (gate.trigger_type !== 'comment_on_post') continue;
    // Junction array is source of truth; fall back to legacy column.
    const targets =
      gate.target_post_ids && gate.target_post_ids.length > 0
        ? gate.target_post_ids
        : gate.target_post_id
          ? [gate.target_post_id]
          : [];
    const scopeMatches = targets.length === 0 || targets.includes(args.postId);
    if (!scopeMatches) continue;
    const keywordMatches =
      !gate.trigger_keyword || args.commentText.includes(gate.trigger_keyword);
    if (!keywordMatches) continue;
    const scopeScore = targets.length > 0 ? 2 : 0;
    const keywordScore = gate.trigger_keyword ? 1 : 0;
    candidates.push({ gate, score: scopeScore + keywordScore });
  }
  candidates.sort((a, b) =>
    b.score - a.score ||
    // Tie-break by newest first so an operator's most recent edit wins.
    (b.gate.created_at || '').localeCompare(a.gate.created_at || ''),
  );

  for (const { gate } of candidates) {

    const delivery = await createGateDelivery(db, {
      gate_id: gate.id,
      follower_id: args.follower.id,
      igsid: args.follower.igsid,
      allow_repeat: gate.allow_repeat,
    });

    // Idempotent: only send the CTA on the very first trigger. The
    // unique (gate_id, follower_id) constraint means a follower has
    // exactly one delivery per gate; any subsequent comment/DM that
    // matches the same gate must NOT resend the CTA, regardless of
    // current status (cta_sent, pending_follow, delivered, dropped).
    // Idempotent skip — but allow_repeat=1 gates always proceed so the
    // same follower can run the CTA → reward flow again (demo/nurture).
    if (gate.allow_repeat !== 1 && delivery.status !== 'triggered') {
      return true;
    }

    await sendCtaDm(db, igClient, gate, delivery, args.igAccount);
    await updateGateDelivery(db, delivery.id, { status: 'cta_sent' });

    // Optional public comment. Posted after the DM so a failure doesn't
    // block delivery.
    //
    // Why postCommentToMedia instead of replyToComment:
    //   /{comment_id}/replies requires Advanced Access for external
    //   commenters' comments — under Standard Access it always returns
    //   "Object does not exist". Top-level comment with @username has
    //   identical UX (visible mention to the commenter) and works under
    //   Standard Access since the app owner is posting on their own media.
    //
    // Supports rotation: comment_reply_text can be a plain string OR a
    // JSON array of strings. When it's an array, a random entry is
    // picked per delivery so the replies don't look robotic.
    if (gate.comment_reply_text) {
      const patterns = parseCommentReplyPatterns(gate.comment_reply_text);
      if (patterns.length > 0) {
        const picked = patterns[Math.floor(Math.random() * patterns.length)]!;
        const replyText = picked.replace(
          /\{\{\s*username\s*\}\}/g,
          args.commenterUsername ?? '',
        );
        try {
          await igClient.postCommentToMedia(args.postId, replyText);
        } catch (err) {
          console.error('[gate] comment post failed:', err);
        }
      }
    }

    return true; // Only one gate per comment
  }
  return false;
}

export async function triggerGateForDmKeyword(
  db: D1Database,
  igClient: IgClientLike,
  args: { text: string; follower: FollowerRef; igAccount?: IgAccountRef; accountId?: string },
): Promise<boolean> {
  const gates = await listEngagementGates(db, { activeOnly: true, accountId: args.accountId });
  for (const gate of gates) {
    if (gate.trigger_type !== 'dm_keyword') continue;
    if (!gate.trigger_keyword || !args.text.includes(gate.trigger_keyword)) continue;

    const delivery = await createGateDelivery(db, {
      gate_id: gate.id,
      follower_id: args.follower.id,
      igsid: args.follower.igsid,
      allow_repeat: gate.allow_repeat,
    });

    // Idempotent: only send the CTA on the very first trigger.
    // Idempotent skip — but allow_repeat=1 gates always proceed so the
    // same follower can run the CTA → reward flow again (demo/nurture).
    if (gate.allow_repeat !== 1 && delivery.status !== 'triggered') {
      return true;
    }

    await sendCtaDm(db, igClient, gate, delivery, args.igAccount);
    await updateGateDelivery(db, delivery.id, { status: 'cta_sent' });
    return true;
  }
  return false;
}

export async function triggerGateForStoryMention(
  db: D1Database,
  igClient: IgClientLike,
  args: { follower: FollowerRef; igAccount?: IgAccountRef; accountId?: string },
): Promise<boolean> {
  const gates = await listEngagementGates(db, { activeOnly: true, accountId: args.accountId });
  for (const gate of gates) {
    if (gate.trigger_type !== 'story_mention') continue;

    const delivery = await createGateDelivery(db, {
      gate_id: gate.id,
      follower_id: args.follower.id,
      igsid: args.follower.igsid,
      allow_repeat: gate.allow_repeat,
    });

    // Idempotent: only send the CTA on the very first trigger.
    // Idempotent skip — but allow_repeat=1 gates always proceed so the
    // same follower can run the CTA → reward flow again (demo/nurture).
    if (gate.allow_repeat !== 1 && delivery.status !== 'triggered') {
      return true;
    }

    await sendCtaDm(db, igClient, gate, delivery, args.igAccount);
    await updateGateDelivery(db, delivery.id, { status: 'cta_sent' });
    return true;
  }
  return false;
}

/**
 * Parse comment_reply_text into a list of candidate patterns. Accepts
 * either a JSON array of strings (the wizard stores it this way so the
 * operator can rotate up to 3 phrasings) or a single plain string. The
 * result is always a non-empty array on success, empty array otherwise.
 */
function parseCommentReplyPatterns(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const strs = parsed
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter((x) => x.length > 0);
        if (strs.length > 0) return strs;
      }
    } catch {
      // Fall through to single-pattern treatment.
    }
  }
  return [trimmed];
}

/**
 * Produce a readable operator label for a rich-message block array.
 * Shows the first text content found, or a block-count summary.
 */
function richMessageLabel(blocks: RichMessageBlock[]): string {
  for (const block of blocks) {
    if (block.type === 'text' && block.text) return `[リッチメッセージ] ${block.text.slice(0, 100)}`;
    if (block.type === 'card' && block.title) return `[リッチメッセージ] ${block.title}`;
  }
  return `[リッチメッセージ] ${blocks.length}ブロック`;
}

async function sendCtaDm(
  db: D1Database,
  igClient: IgClientLike,
  gate: EngagementGate,
  delivery: GateDelivery,
  igAccount?: IgAccountRef,
): Promise<void> {
  const payload = `CHECK_FOLLOW:${gate.id}:${delivery.id}`;

  if (gate.initial_dm_rich_message_id) {
    const rm = await getRichMessage(db, gate.initial_dm_rich_message_id);
    if (rm) {
      const rewardUrl = await effectiveRewardUrl(db, gate, delivery.igsid, igAccount);
      await igClient.sendRichMessage(delivery.igsid, rm.blocks, {
        gateId: gate.id,
        deliveryId: delivery.id,
        rewardUrl,
      });
      await logMessage(db, {
        followerId: delivery.follower_id,
        direction: 'out',
        messageType: 'template',
        body: richMessageLabel(rm.blocks),
        triggerSource: 'gate',
      });
      return;
    }
    // fall through to legacy text path on missing reference
  }

  await igClient.sendGenericTemplate(delivery.igsid, [
    {
      title: gate.initial_dm_text.slice(0, 80),
      subtitle: gate.initial_dm_text.length > 80 ? gate.initial_dm_text.slice(80, 200) : undefined,
      buttons: [
        { type: 'postback', title: gate.initial_dm_button_label, payload },
      ],
    },
  ]);
  await logMessage(db, {
    followerId: delivery.follower_id,
    direction: 'out',
    messageType: 'template',
    body: gate.initial_dm_text,
    triggerSource: 'gate',
  });
}

export async function handleFollowCheckPostback(
  db: D1Database,
  igClient: IgClientLike,
  args: { gateId: string; deliveryId: string; igsid: string; workerBaseUrl?: string; igAccount?: IgAccountRef },
): Promise<void> {
  const [gate, delivery] = await Promise.all([
    getEngagementGate(db, args.gateId),
    getGateDelivery(db, args.deliveryId),
  ]);
  if (!gate || !delivery) return;
  if (delivery.status === 'delivered' || delivery.status === 'dropped') return;
  // Honour the operator pause/archive switch even for already-issued CTAs.
  if (gate.status !== 'active') return;

  const now = new Date().toISOString();

  // Skip Graph API entirely when follow is not required so a transient
  // profile lookup failure can't block reward delivery.
  if (gate.require_follow === 0) {
    await deliverReward(db, igClient, gate, delivery, args.workerBaseUrl, args.igAccount);
    const patch: Parameters<typeof updateGateDelivery>[2] = {
      status: 'delivered',
      delivered_at: now,
      last_check_at: now,
    };
    const next = nextFollowupAt(gate, 0, now);
    if (next) patch.next_followup_at = next;
    await updateGateDelivery(db, delivery.id, patch);
    return;
  }

  // Realtime follow check (do NOT trust DB cache)
  const profile = await igClient.getUserProfile(args.igsid);
  const isFollowing = profile.is_user_follow_business === true;

  if (isFollowing) {
    await deliverReward(db, igClient, gate, delivery, args.workerBaseUrl, args.igAccount);
    const patch: Parameters<typeof updateGateDelivery>[2] = {
      status: 'delivered',
      delivered_at: now,
      last_check_at: now,
    };
    // If this gate has a drip sequence, schedule the first step.
    const next = nextFollowupAt(gate, 0, now);
    if (next) patch.next_followup_at = next;
    await updateGateDelivery(db, delivery.id, patch);
    return;
  }

  // Enforce max_loops if configured (0 = unlimited, ManyChat behaviour)
  const nextLoopCount = delivery.loop_count + 1;
  if (gate.max_loops > 0 && nextLoopCount > gate.max_loops) {
    await updateGateDelivery(db, delivery.id, {
      status: 'dropped',
      loop_count: nextLoopCount,
      last_check_at: now,
    });
    return;
  }

  // Send reminder + same button (loop)
  await sendReminderDm(db, igClient, gate, delivery, args.igAccount);
  await updateGateDelivery(db, delivery.id, {
    status: 'pending_follow',
    loop_count: nextLoopCount,
    last_check_at: now,
  });
}

async function sendReminderDm(
  db: D1Database,
  igClient: IgClientLike,
  gate: EngagementGate,
  delivery: GateDelivery,
  igAccount?: IgAccountRef,
): Promise<void> {
  const payload = `CHECK_FOLLOW:${gate.id}:${delivery.id}`;

  if (gate.follow_reminder_dm_rich_message_id) {
    const rm = await getRichMessage(db, gate.follow_reminder_dm_rich_message_id);
    if (rm) {
      const rewardUrl = await effectiveRewardUrl(db, gate, delivery.igsid, igAccount);
      await igClient.sendRichMessage(delivery.igsid, rm.blocks, {
        gateId: gate.id,
        deliveryId: delivery.id,
        rewardUrl,
      });
      await logMessage(db, {
        followerId: delivery.follower_id,
        direction: 'out',
        messageType: 'template',
        body: richMessageLabel(rm.blocks),
        triggerSource: 'gate',
      });
      return;
    }
  }

  await igClient.sendGenericTemplate(delivery.igsid, [
    {
      title: gate.follow_reminder_dm_text.slice(0, 80),
      subtitle: gate.follow_reminder_dm_text.length > 80
        ? gate.follow_reminder_dm_text.slice(80, 200)
        : undefined,
      buttons: [
        { type: 'postback', title: gate.follow_reminder_button_label, payload },
      ],
    },
  ]);
  await logMessage(db, {
    followerId: delivery.follower_id,
    direction: 'out',
    messageType: 'template',
    body: gate.follow_reminder_dm_text,
    triggerSource: 'gate',
  });
}

function expandIgsidPlaceholder(template: string, igsid: string): string {
  // Support both {IGSID} and {{IGSID}} so the dashboard hint and the more
  // common Mustache-style placeholder both work.
  return template
    .replace(/\{\{\s*IGSID\s*\}\}/g, igsid)
    .replace(/\{\s*IGSID\s*\}/g, igsid);
}

async function deliverReward(
  db: D1Database,
  igClient: IgClientLike,
  gate: EngagementGate,
  delivery: GateDelivery,
  workerBaseUrl?: string,
  igAccount?: IgAccountRef,
): Promise<void> {
  // Two-layer URL rewriting, outer-in:
  //   1. LINE Harness tracked link: captures IG↔LINE userId pair on click.
  //   2. IG Harness click wrapper: records the tap in gate_clicks for
  //      campaign analytics before 302'ing to the LINE Harness redirect.
  // Either layer can be skipped independently (no line_connection_id on
  // the gate, or no workerBaseUrl in env) — raw reward_url is the fallback.
  const baseUrl = await effectiveRewardUrl(db, gate, delivery.igsid, igAccount);
  const trackedRewardUrl =
    workerBaseUrl && baseUrl
      ? wrapClickTracking(workerBaseUrl, gate.id, baseUrl, delivery.igsid)
      : baseUrl ?? null;

  // Delivery log: the operator-visible audit trail showing which tracked
  // link short id was used for this recipient. A fully linked recipient
  // will appear in LINE Harness's friends.ig_igsid after first click.
  if (gate.line_tracked_link_short) {
    console.log(
      `[gate-deliver] gate=${gate.id} → tracked link: ${gate.line_tracked_link_short} (IG=${hashIgsid(delivery.igsid)}, LINE=pending)`,
    );
  }

  if (gate.reward_dm_rich_message_id) {
    const rm = await getRichMessage(db, gate.reward_dm_rich_message_id);
    if (rm) {
      await igClient.sendRichMessage(delivery.igsid, rm.blocks, {
        gateId: gate.id,
        deliveryId: delivery.id,
        rewardUrl: trackedRewardUrl,
      });
      await logMessage(db, {
        followerId: delivery.follower_id,
        direction: 'out',
        messageType: 'template',
        body: richMessageLabel(rm.blocks),
        triggerSource: 'gate',
      });
      return;
    }
  }

  let text = expandIgsidPlaceholder(gate.reward_dm_text, delivery.igsid);
  if (trackedRewardUrl) {
    text = `${text}\n\n${trackedRewardUrl}`;
  }
  await igClient.sendText(delivery.igsid, text);
  await logMessage(db, {
    followerId: delivery.follower_id,
    direction: 'out',
    messageType: 'text',
    body: text,
    triggerSource: 'gate',
  });
}

/**
 * Short, non-reversible-ish hash for log lines. Full IGSIDs are PII-ish
 * identifiers; the 8-char prefix lets operators spot patterns in the log
 * without exposing the complete id to anyone tailing Wrangler output.
 */
function hashIgsid(igsid: string): string {
  return igsid.slice(0, 8);
}

// ─── 24h follow-up drip ───────────────────────────────────────────

/**
 * Given a gate and the index of the *next* step to fire (0-based), return
 * the ISO timestamp at which it should fire, or null if there is no next
 * step. `anchor` is the time from which delay_minutes is measured — the
 * reward delivery timestamp for step 0, or the previous followup's send
 * time for subsequent steps.
 */
export function nextFollowupAt(
  gate: Pick<EngagementGate, 'followup_dm_sequence'>,
  stepIndex: number,
  anchorIso: string,
): string | null {
  const steps = parseFollowupSequence(gate.followup_dm_sequence);
  if (stepIndex >= steps.length) return null;
  const step = steps[stepIndex]!;
  const anchor = new Date(anchorIso);
  const due = new Date(anchor.getTime() + step.delay_minutes * 60_000);
  return due.toISOString().slice(0, 19) + 'Z';
}

/**
 * Cron-driven processor. Finds gate_deliveries whose next_followup_at has
 * passed, sends the scheduled message, and advances the counter + next
 * schedule. Runs every cron tick (every 5 min). Caps work per tick to
 * avoid cron timeouts.
 *
 * 24h-window guard: Meta only allows sending outside the 24h window for
 * certain tags, so we refuse any step whose fire time is more than 24h
 * after the reward delivery. That keeps operators who typed 1500 minutes
 * (instead of 150) from getting their DMs silently rejected / flagged.
 */
export async function processFollowupDrip(
  db: D1Database,
  igClient: IgClientLike,
  workerBaseUrl?: string,
  maxPerTick = 50,
  igAccount?: IgAccountRef,
  accountId?: string,
): Promise<{ sent: number; skipped: number }> {
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  // When accountId is given, scope the due extraction to deliveries whose
  // gate belongs to that IG account (multi-account cron loop).
  const due = accountId
    ? await db
        .prepare(
          `SELECT gd.* FROM gate_deliveries gd
           JOIN engagement_gates g ON g.id = gd.gate_id AND g.account_id = ?
           WHERE gd.status = 'delivered'
             AND gd.next_followup_at IS NOT NULL
             AND gd.next_followup_at <= ?
           ORDER BY gd.next_followup_at ASC
           LIMIT ?`,
        )
        .bind(accountId, now, maxPerTick)
        .all<GateDelivery>()
    : await db
        .prepare(
          `SELECT * FROM gate_deliveries
           WHERE status = 'delivered'
             AND next_followup_at IS NOT NULL
             AND next_followup_at <= ?
           ORDER BY next_followup_at ASC
           LIMIT ?`,
        )
        .bind(now, maxPerTick)
        .all<GateDelivery>();

  let sent = 0;
  let skipped = 0;
  for (const d of due.results) {
    const gate = await getEngagementGate(db, d.gate_id);
    if (!gate) {
      await updateGateDelivery(db, d.id, { next_followup_at: null });
      skipped++;
      continue;
    }
    const steps = parseFollowupSequence(gate.followup_dm_sequence);
    const stepIdx = d.followup_step_sent;
    const step = steps[stepIdx];
    if (!step) {
      await updateGateDelivery(db, d.id, { next_followup_at: null });
      skipped++;
      continue;
    }

    // 24h guard: don't send past the Meta messaging window.
    if (d.delivered_at) {
      const deliveredAt = new Date(d.delivered_at).getTime();
      if (Date.now() - deliveredAt > 24 * 60 * 60_000) {
        await updateGateDelivery(db, d.id, { next_followup_at: null });
        skipped++;
        continue;
      }
    }

    try {
      await sendFollowupStep(db, igClient, d.igsid, step, gate, workerBaseUrl, igAccount, d.follower_id);
    } catch (err) {
      console.error('[followup] send failed:', err);
      await recordDmFailure(db, accountId ?? 'unknown').catch(() => {});
      // Skip forward — don't retry indefinitely on the same step.
    }

    const nextStep = stepIdx + 1;
    const nextAt = nextFollowupAt(gate, nextStep, new Date().toISOString().slice(0, 19) + 'Z');
    await updateGateDelivery(db, d.id, {
      followup_step_sent: nextStep,
      next_followup_at: nextAt,
    });
    sent++;
  }
  return { sent, skipped };
}

async function sendFollowupStep(
  db: D1Database,
  igClient: IgClientLike,
  igsid: string,
  step: { text: string; image_url?: string; button_label?: string; button_url?: string },
  gate: EngagementGate,
  workerBaseUrl?: string,
  igAccount?: IgAccountRef,
  followerId?: number,
): Promise<void> {
  // Same two-layer wrap as deliverReward — follow-up taps also flow
  // through both LINE Harness cross-link and IG Harness click tracking.
  const baseUrl = await effectiveRewardUrl(db, gate, igsid, igAccount);
  const trackedRewardUrl =
    workerBaseUrl && baseUrl
      ? wrapClickTracking(workerBaseUrl, gate.id, baseUrl, igsid)
      : baseUrl ?? '';

  const expandedText = expandIgsidPlaceholder(
    step.text.replace(/\{\{?\s*REWARD_URL\s*\}?\}/g, trackedRewardUrl),
    igsid,
  );

  if (step.image_url) {
    await igClient.sendImage(igsid, step.image_url);
    if (followerId !== undefined) {
      await logMessage(db, {
        followerId,
        direction: 'out',
        messageType: 'text',
        body: `[画像] ${step.image_url}`,
        triggerSource: 'gate',
      });
    }
  }

  if (step.button_label && step.button_url) {
    // Text + one URL button → use a minimal generic template.
    // Wrap the button URL too (unless it's already a click-tracked URL or
    // a placeholder that already got the wrapped value).
    let buttonUrl = step.button_url.replace(/\{\{?\s*REWARD_URL\s*\}?\}/g, trackedRewardUrl);
    if (workerBaseUrl && /^https?:\/\//.test(buttonUrl) && !buttonUrl.includes('/click/')) {
      buttonUrl = wrapClickTracking(workerBaseUrl, gate.id, buttonUrl, igsid);
    }
    await igClient.sendGenericTemplate(igsid, [
      {
        title: expandedText.slice(0, 80),
        subtitle: expandedText.length > 80 ? expandedText.slice(80, 160) : undefined,
        buttons: [
          { type: 'web_url', title: step.button_label.slice(0, 20), url: buttonUrl },
        ],
      },
    ]);
    if (followerId !== undefined) {
      await logMessage(db, { followerId, direction: 'out', messageType: 'template', body: expandedText, triggerSource: 'gate' });
    }
  } else {
    await igClient.sendText(igsid, expandedText);
    if (followerId !== undefined) {
      await logMessage(db, { followerId, direction: 'out', messageType: 'text', body: expandedText, triggerSource: 'gate' });
    }
  }
}
