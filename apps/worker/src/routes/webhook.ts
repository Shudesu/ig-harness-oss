import { Hono } from 'hono';
import {
  InstagramClient,
  verifyWebhookSignature,
  verifyWebhookChallenge,
} from '@ig-harness/ig-sdk';
import type { WebhookPayload, MessagingEvent } from '@ig-harness/ig-sdk';
import {
  upsertFriend,
  getFriendByIgsid,
  getScenarios,
  enrollFriendInScenario,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  jstNow,
  logMessage,
} from '@ig-harness/db';
import { buildIgMessage, expandVariables } from '../services/step-delivery.js';
import { handleFollowCheckPostback, triggerGateForComment, triggerGateForDmKeyword, triggerGateForStoryMention } from '../services/engagement-gate.js';
import type { IgAccountRef } from '../services/line-cross-link.js';
import { listIgAccounts } from '@ig-harness/db';
import { ensureDefaultAccount, pickAccountForEntry, toIgAccountRef, getAccountClient } from '../lib/accounts.js';
import { recordWebhookReceived } from '../lib/health.js';
import type { Env } from '../index.js';

export type PostbackPayload =
  | { kind: 'check_follow'; gateId: string; deliveryId: string }
  | { kind: 'unknown' };

export function parsePostbackPayload(raw: string): PostbackPayload {
  if (!raw) return { kind: 'unknown' };
  if (raw.startsWith('CHECK_FOLLOW:')) {
    const parts = raw.split(':');
    if (parts.length === 3 && parts[1] && parts[2]) {
      return { kind: 'check_follow', gateId: parts[1], deliveryId: parts[2] };
    }
  }
  return { kind: 'unknown' };
}

export function isStoryMentionMessagingEvent(event: MessagingEvent): boolean {
  const referralSource = event.referral?.source?.toUpperCase();
  const referralRef = event.referral?.ref?.toUpperCase();
  return referralSource === 'STORY_MENTION'
    || referralRef === 'STORY_MENTION'
    || event.message?.attachments?.some((attachment) => attachment.type === 'story_mention') === true;
}

const webhook = new Hono<Env>();

// GET /webhook — Meta verification challenge
webhook.get('/webhook', async (c) => {
  const mode = c.req.query('hub.mode') ?? null;
  const token = c.req.query('hub.verify_token') ?? null;
  const challenge = c.req.query('hub.challenge') ?? null;

  // Accounts connected through a different Meta App carry their own verify
  // token — accept any known one so each App's webhook subscription succeeds.
  await ensureDefaultAccount(c.env, c.env.DB);
  const accounts = await listIgAccounts(c.env.DB);
  const expectedTokens = [c.env.IG_VERIFY_TOKEN, ...accounts.map((a) => a.verify_token)]
    .filter((t): t is string => !!t);
  for (const expected of expectedTokens) {
    const result = verifyWebhookChallenge(mode, token, challenge, expected);
    if (result) {
      return c.text(result, 200);
    }
  }
  return c.json({ error: 'Verification failed' }, 403);
});

// POST /webhook — Instagram webhook events
webhook.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Hub-Signature-256') ?? '';
  const db = c.env.DB;

  // Verify signature — env App Secret first, then per-account secrets so
  // accounts connected through a different Meta App also validate.
  await ensureDefaultAccount(c.env, c.env.DB);
  const accounts = await listIgAccounts(c.env.DB);
  const secrets = [c.env.IG_APP_SECRET, ...accounts.map((a) => a.app_secret)]
    .filter((sec): sec is string => !!sec)
    .filter((sec, i, arr) => arr.indexOf(sec) === i);
  // Empty/missing header is immediately invalid — skip the secret loop.
  if (!signature) {
    return c.json({ error: 'invalid signature' }, 403);
  }

  let valid = false;
  for (const secret of secrets) {
    if (await verifyWebhookSignature(rawBody, signature, secret)) {
      valid = true;
      break;
    }
  }
  if (!valid) {
    console.warn('[webhook] signature verification failed; rejecting request');
    return c.json({ error: 'invalid signature' }, 403);
  }

  let body: WebhookPayload;
  try {
    body = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    console.error('[webhook] failed to parse body');
    return c.json({ status: 'ok' }, 200);
  }

  console.log('[webhook] object:', body.object, 'entries:', body.entry?.length ?? 0);

  if (body.object !== 'instagram') {
    console.log('Skipping non-instagram webhook, object:', body.object);
    return c.json({ status: 'ok' }, 200);
  }

  // Process asynchronously — Meta expects quick response
  const processingPromise = (async () => {
    for (const entry of body.entry) {
      // entry.id is the receiving business account's IG user id — resolve
      // which managed account this entry belongs to before any processing.
      const account = pickAccountForEntry(accounts, entry.id);
      if (!account) {
        console.warn(`[webhook] no account matches entry.id=${entry.id} (accounts=${accounts.length}); skipping entry`);
        continue;
      }
      // Register on waitUntil: the enclosing promise can settle before this
      // D1 write completes (e.g. entries with no messaging work).
      c.executionCtx.waitUntil(recordWebhookReceived(db, account.id).catch(() => {}));
      const igClient = await getAccountClient(c.env, db, account);
      const igAccount: IgAccountRef = toIgAccountRef(account);

      // Handle DM messaging events (messaging = primary, standby = secondary receiver)
      const messagingEvents = entry.messaging ?? entry.standby ?? [];
      for (const event of messagingEvents) {
        try {
          await handleMessagingEvent(db, igClient, event, c.env.WORKER_URL, igAccount, account.id);
        } catch (err) {
          console.error('Error handling messaging event:', err);
        }
      }

      // Handle comment/mention change events
      if (entry.changes) {
        for (const change of entry.changes) {
          try {
            if (change.field === 'comments') {
              await handleCommentEvent(db, igClient, change.value, account.ig_user_id, c.env.WORKER_URL, igAccount, account.id);
            } else if (change.field === 'mentions') {
              console.info(
                '[mention] feed/comment mention ignored; story mentions arrive as messaging events',
              );
            }
          } catch (err) {
            console.error('Error handling change event:', err);
          }
        }
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);
  return c.json({ status: 'ok' }, 200);
});

async function handleMessagingEvent(
  db: D1Database,
  igClient: InstagramClient,
  event: MessagingEvent,
  workerUrl?: string,
  igAccount?: IgAccountRef,
  accountId?: string,
): Promise<void> {
  const senderId = event.sender.id;

  // Skip echo messages (our own outgoing messages)
  if (event.message?.is_echo) return;

  // Upsert follower (get profile from IG)
  let profile;
  try {
    profile = await igClient.getUserProfile(senderId);
  } catch (err) {
    console.error('Failed to get profile for', senderId, err);
  }

  const follower = await upsertFriend(db, {
    igsid: senderId,
    username: profile?.username ?? null,
    displayName: profile?.name ?? null,
    pictureUrl: profile?.profile_pic ?? null,
    isFollowing: profile?.is_user_follow_business ?? false,
    followerCount: profile?.follower_count ?? null,
    isVerified: profile?.is_verified_user ?? false,
    accountId,
  });

  if (isStoryMentionMessagingEvent(event)) {
    await handleStoryMentionEvent(
      db,
      igClient,
      follower.id,
      senderId,
      profile?.username ?? 'friend',
      igAccount,
      accountId,
    );
    return;
  }

  if (event.message?.text) {
    const incomingText = event.message.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // Log incoming message
    await db
      .prepare(
        `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
         VALUES (?, 'in', 'text', ?, NULL)`,
      )
      .bind(follower.id, JSON.stringify({ text: incomingText }))
      .run();

    // Check LINE Harness UUID linkage token
    if (incomingText.startsWith('CONNECT:')) {
      const token = incomingText.slice(8).trim();
      // Look up token in tracked_links (ref_code = token, destination contains uid)
      const link = await db
        .prepare("SELECT destination_url FROM tracked_links WHERE ref_code = ?")
        .bind(token)
        .first<{ destination_url: string }>();

      if (link) {
        // Extract uid from destination URL
        const url = new URL(link.destination_url);
        const uid = url.searchParams.get('uid');
        if (uid) {
          await db
            .prepare("UPDATE followers SET external_user_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(uid, follower.id)
            .run();

          await igClient.sendText(senderId, '✅ LINE連携が完了しました！LINEとInstagramのアカウントが紐づけられました。');

          await db
            .prepare(
              `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
               VALUES (?, 'out', 'text', ?, 'manual')`,
            )
            .bind(follower.id, JSON.stringify({ text: 'LINE連携完了通知' }))
            .run();
        }
      } else {
        await igClient.sendText(senderId, '❌ 無効な連携コードです。LINEから再度リンクを取得してください。');
      }
      return; // Don't process further
    }

    // Engagement gate DM keyword trigger
    try {
      const triggered = await triggerGateForDmKeyword(db, igClient, {
        text: incomingText,
        follower: { id: follower.id, igsid: senderId },
        igAccount,
        accountId,
      });
      if (triggered) {
        // Skip scenario triggers if gate fired
        return;
      }
    } catch (err) {
      console.error('DM keyword gate trigger failed:', err);
    }

    // Check dm_keyword scenario triggers
    {
      const scenarios = await getScenarios(db, { accountId });
      for (const scenario of scenarios) {
        if (
          scenario.trigger_type === 'dm_keyword' &&
          scenario.is_active &&
          scenario.trigger_keyword
        ) {
          if (incomingText.includes(scenario.trigger_keyword)) {
            const existing = await db
              .prepare(`SELECT id FROM follower_scenarios WHERE follower_id = ? AND scenario_id = ?`)
              .bind(follower.id, scenario.id)
              .first<{ id: string }>();
            if (!existing) {
              const friendScenario = await enrollFriendInScenario(db, follower.id, scenario.id);

              // Immediate delivery of first step if delay=0
              const steps = await getScenarioSteps(db, scenario.id);
              const firstStep = steps[0];
              if (firstStep && firstStep.delay_minutes === 0 && friendScenario.status === 'active') {
                try {
                  const expandedContent = expandVariables(firstStep.body, follower);
                  const parsed = JSON.parse(expandedContent);
                  await sendIgResponse(igClient, senderId, firstStep.message_type, parsed);

                  await db
                    .prepare(
                      `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
                       VALUES (?, 'out', ?, ?, 'scenario')`,
                    )
                    .bind(follower.id, firstStep.message_type, firstStep.body)
                    .run();

                  const secondStep = steps[1] ?? null;
                  if (secondStep) {
                    const nextDeliveryDate = new Date(Date.now() + 9 * 60 * 60_000);
                    nextDeliveryDate.setMinutes(nextDeliveryDate.getMinutes() + secondStep.delay_minutes);
                    await advanceFriendScenario(db, friendScenario.id, firstStep.step_order, nextDeliveryDate.toISOString().slice(0, -1) + '+09:00');
                  } else {
                    await completeFriendScenario(db, friendScenario.id);
                  }
                } catch (err) {
                  console.error('Failed immediate delivery for scenario', scenario.id, err);
                }
              }
            }
            break;
          }
        }
      }
    }

  }

  // Handle postback events
  if (event.postback) {
    const payload = parsePostbackPayload(event.postback.payload ?? '');
    if (payload.kind === 'check_follow') {
      try {
        await handleFollowCheckPostback(db, igClient, {
          gateId: payload.gateId,
          deliveryId: payload.deliveryId,
          igsid: senderId,
          workerBaseUrl: workerUrl,
          igAccount,
        });
        // Log button press as inbound gate message
        const postbackTitle = event.postback.title ?? event.postback.payload ?? '';
        await logMessage(db, {
          followerId: follower.id,
          direction: 'in',
          messageType: 'quick_reply',
          body: `[ボタン] ${postbackTitle}`,
          triggerSource: 'gate',
        });
      } catch (err) {
        console.error('Follow check postback failed:', err);
      }
    } else {
      console.log('Unknown postback payload:', event.postback.payload);
    }
  }
}

async function handleCommentEvent(
  db: D1Database,
  igClient: InstagramClient,
  value: { id: string; text: string; from: { id: string; username: string }; media: { id: string }; created_time: string },
  igUserId: string,
  _workerUrl?: string,
  igAccount?: IgAccountRef,
  accountId?: string,
): Promise<void> {
  const senderId = value.from.id;
  const commentText = value.text;
  const mediaId = value.media.id;

  // Skip our own comments — when the gate posts a public reply via
  // postCommentToMedia, IG fires a comment webhook for that too. Without
  // this guard we'd try to DM ourselves, fail, and pollute the gate
  // delivery table with a self-trigger.
  if (senderId === igUserId) {
    return;
  }

  // Upsert follower
  let profile;
  try {
    profile = await igClient.getUserProfile(senderId);
  } catch {
    // Profile fetch may fail for non-followers
  }

  const follower = await upsertFriend(db, {
    igsid: senderId,
    username: value.from.username ?? profile?.username ?? null,
    displayName: profile?.name ?? null,
    pictureUrl: profile?.profile_pic ?? null,
    isFollowing: profile?.is_user_follow_business ?? false,
    followerCount: profile?.follower_count ?? null,
    isVerified: profile?.is_verified_user ?? false,
    accountId,
  });

  // Engagement gate trigger — runs FIRST so a configured gate takes precedence
  // over the legacy comment-rule flow. If a gate fires, we skip the rule loop
  // and the gate-triggered scenarios below to avoid double DMs.
  let gateFired = false;
  try {
    gateFired = await triggerGateForComment(db, igClient, {
      postId: mediaId,
      commentText,
      follower: { id: follower.id, igsid: senderId },
      commentId: value.id,
      commenterUsername: value.from?.username,
      igAccount,
      accountId,
    });
  } catch (err) {
    console.error('Engagement gate trigger failed:', err);
  }

  // Check comment rules (match by keyword + optional media filter)
  // Only when no gate fired — gates supersede legacy rules.
  const commentRules = gateFired
    ? { results: [] as Array<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains' | 'regex' | 'any_comment';
        media_id: string | null;
        response_type: string;
        response_body: string;
        delay_seconds: number;
      }> }
    : await db
        .prepare(
          // Rule precedence:
          //   1. keyword-specific rules (exact / contains / regex) before catch-all
          //   2. post-scoped rules before account-wide rules (media_id NOT NULL first)
          //   3. oldest first (stable)
          // Without (2) a global `any_comment` would always shadow a later
          // post-specific `any_comment` on the same post.
          `SELECT * FROM comment_rules WHERE is_active = 1
           ${accountId ? 'AND account_id = ?' : ''}
           ORDER BY CASE match_type WHEN 'any_comment' THEN 1 ELSE 0 END ASC,
                    CASE WHEN media_id IS NULL THEN 1 ELSE 0 END ASC,
                    created_at ASC`,
        )
        .bind(...(accountId ? [accountId] : []))
        .all<{
          id: string;
          keyword: string;
          match_type: 'exact' | 'contains' | 'regex' | 'any_comment';
          media_id: string | null;
          response_type: string;
          response_body: string;
          delay_seconds: number;
        }>();

  for (const rule of commentRules.results) {
    // Media filter: if rule specifies a media_id, only match that post
    if (rule.media_id && rule.media_id !== mediaId) continue;

    let isMatch = false;
    if (rule.match_type === 'any_comment') {
      // No keyword check — any comment on the targeted media (or all media
      // when media_id is NULL) fires the rule.
      isMatch = true;
    } else if (rule.match_type === 'exact') {
      isMatch = commentText === rule.keyword;
    } else if (rule.match_type === 'contains') {
      isMatch = commentText.toLowerCase().includes(rule.keyword.toLowerCase());
    } else if (rule.match_type === 'regex') {
      try {
        isMatch = new RegExp(rule.keyword, 'i').test(commentText);
      } catch {
        isMatch = false;
      }
    }

    if (isMatch) {
      // Apply delay if configured
      if (rule.delay_seconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, rule.delay_seconds * 1000));
      }

      // Reply to the comment itself
      try {
        const replyText = (rule as any).reply_text
          ? (rule as any).reply_text.replace('{{username}}', value.from.username)
          : `@${value.from.username} コメントありがとう！📩 DMを送りました！`;
        await igClient.replyToComment(value.id, replyText);
      } catch (err) {
        console.error('Comment reply failed:', err);
      }

      // Send DM to commenter (expand variables in response body)
      const expandedBody = rule.response_body
        .replace(/\{\{igsid\}\}/g, senderId)
        .replace(/\{\{username\}\}/g, value.from.username)
        .replace(/\{\{follower_id\}\}/g, String(follower.id));
      const responseBody = JSON.parse(expandedBody);
      await sendIgResponse(igClient, senderId, rule.response_type, responseBody);

      // Log outgoing message
      await db
        .prepare(
          `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
           VALUES (?, 'out', ?, ?, 'comment_rule')`,
        )
        .bind(follower.id, rule.response_type, rule.response_body)
        .run();

      break; // Only send first matching rule
    }
  }

  // Check comment-triggered scenarios — skip if a gate fired
  if (gateFired) return;
  const scenarios = await getScenarios(db, { accountId });
  for (const scenario of scenarios) {
    if (scenario.trigger_type === 'comment' && scenario.is_active) {
      const keywordMatch = !scenario.trigger_keyword || commentText.toLowerCase().includes(scenario.trigger_keyword.toLowerCase());
      if (keywordMatch) {
        const existing = await db
          .prepare(`SELECT id FROM follower_scenarios WHERE follower_id = ? AND scenario_id = ?`)
          .bind(follower.id, scenario.id)
          .first<{ id: string }>();
        if (!existing) {
          await enrollFriendInScenario(db, follower.id, scenario.id);
        }
      }
    }
  }

}

/**
 * Send an IG response based on message type.
 */
async function sendIgResponse(
  igClient: InstagramClient,
  recipientId: string,
  responseType: string,
  body: Record<string, unknown>,
): Promise<void> {
  switch (responseType) {
    case 'text':
      await igClient.sendText(recipientId, body.text as string);
      break;
    case 'image':
      await igClient.sendImage(recipientId, body.url as string);
      break;
    case 'template':
      await igClient.sendGenericTemplate(recipientId, body.elements as never[]);
      break;
    case 'quick_reply':
      await igClient.sendQuickReply(
        recipientId,
        body.text as string,
        body.quick_replies as never[],
      );
      break;
    default:
      if (typeof body.text === 'string') {
        await igClient.sendText(recipientId, body.text);
      }
  }
}

// ── Story Mention Handler ──
async function handleStoryMentionEvent(
  db: D1Database,
  igClient: InstagramClient,
  followerId: number,
  mentionerId: string,
  mentionerUsername: string,
  igAccount?: IgAccountRef,
  accountId?: string,
): Promise<void> {
  // Engagement gate trigger (story_mention) — fires before the legacy thank-you DM
  // so a configured campaign takes precedence over the hard-coded reply.
  try {
    const triggered = await triggerGateForStoryMention(db, igClient, {
      follower: { id: followerId, igsid: mentionerId },
      igAccount,
      accountId,
    });
    if (triggered) return;
  } catch (err) {
    console.error('Story mention gate trigger failed:', err);
  }

  // Send thank you DM (fallback when no gate matches)
  try {
    await igClient.sendText(
      mentionerId,
      `@${mentionerUsername} ストーリーズでメンションありがとう！🙏✨ とても嬉しいです！`,
    );

    await db
      .prepare(
        `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
         VALUES (?, 'out', 'text', ?, 'manual')`,
      )
      .bind(followerId, JSON.stringify({ text: `ストーリーズメンション自動返信 to @${mentionerUsername}` }))
      .run();
  } catch (err) {
    console.error('Mention DM failed:', err);
  }
}

export { webhook };
