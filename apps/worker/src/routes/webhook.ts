import { messagingEligibility } from '../services/messaging-window.js';
import { armScheduler } from '../lib/scheduler-client.js';
import { beginActivity, endActivity } from '../lib/activity.js';
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
  logMessage,
} from '@ig-harness/db';
import { processSingleDelivery } from '../services/step-delivery.js';
import { handleFollowCheckPostback, triggerGateForComment, triggerGateForDmKeyword, triggerGateForStoryMention, resumeCommentGate } from '../services/engagement-gate.js';
import type { IgAccountRef } from '../services/line-cross-link.js';
import { listIgAccounts, getIgAccountById } from '@ig-harness/db';
import { ensureDefaultAccount, pickAccountForEntry, toIgAccountRef, getAccountClient } from '../lib/accounts.js';
import { recordWebhookReceived } from '../lib/health.js';
import { queueWebhookEvents, drainWebhookEvents } from '../services/webhook-queue.js';
import { enqueueCommentRuleJob, processCommentRuleJobs, resumeCommentJobs } from '../services/comment-rule-jobs.js';
import type { IgAccount } from '@ig-harness/db';
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
    const result = await verifyWebhookChallenge(mode, token, challenge, expected);
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
  let matchedSecret = '';
  for (const secret of secrets) {
    if (await verifyWebhookSignature(rawBody, signature, secret)) {
      valid = true;
      matchedSecret = secret;
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

  if (!Array.isArray(body.entry)) return c.json({ error: 'Invalid entries' }, 400);
  const accepted: IgAccount[] = [];
  for (const entry of body.entry) {
    const account = pickAccountForEntry(accounts, entry.id);
    if (!account || account.ig_user_id !== entry.id || (account.app_secret || c.env.IG_APP_SECRET) !== matchedSecret) continue;
    const events = [
      ...(entry.messaging ?? []).map((value) => ({ kind: 'messaging', value })),
      ...(entry.standby ?? []).map((value) => ({ kind: 'standby', value })),
      ...(entry.changes ?? []).map((change) => ({ kind: change.field, value: change.value })),
    ];
    // Acknowledge only after durable ingestion succeeds. A D1 error returns
    // non-2xx and Meta can retry; previously accepted events deduplicate.
    await queueWebhookEvents(db, account.id, events);
    c.executionCtx.waitUntil(recordWebhookReceived(db, account.id).catch(() => {}));
    accepted.push(account);
  }
  if (accepted.length && c.env.TENANT_SCHEDULER) await armScheduler(c.env);
  c.executionCtx.waitUntil((async () => {
    for (const account of accepted) {
      const activity = await beginActivity(db);
      if (!activity) continue;
      try {
        const current = await getIgAccountById(db, account.id);
        if (!current || !current.is_active) continue;
        const client = await getAccountClient(c.env, db, current);
        await processQueuedWebhooks(db, client, current, c.env.WORKER_URL);
      } finally { await endActivity(db, activity); }
    }
  })());
  return c.json({ status: 'ok' }, 200);
});

export async function processQueuedWebhooks(db: D1Database, client: InstagramClient, account: IgAccount, workerUrl?: string): Promise<void> {
  await drainWebhookEvents(db, account.id, async (event) => {
    const value = JSON.parse(event.payload);
    const ref = toIgAccountRef(account);
    if (event.kind === 'messaging' || event.kind === 'standby') await handleMessagingEvent(db, client, value, workerUrl, ref, account.id, event.kind === 'standby');
    else if (event.kind === 'comments') await handleCommentEvent(db, client, value, account.ig_user_id, workerUrl, ref, account.id);
    else if (event.kind === 'mentions') await handleMentionEvent(db, client, value, ref, account.id);
  });
  await processCommentRuleJobs(db, client, account.id);
}

export async function getOrRefreshFollower(db: D1Database, client: InstagramClient, igsid: string, accountId?: string, username?: string) {
  const existing = await getFriendByIgsid(db, igsid);
  if (existing && existing.account_id !== accountId) throw new Error('Follower account mismatch');
  const freshness = await db.prepare('SELECT profile_fetched_at FROM followers WHERE igsid=?').bind(igsid).first<{ profile_fetched_at: string | null }>();
  if (existing && freshness?.profile_fetched_at && Date.parse(freshness.profile_fetched_at) > Date.now() - 86_400_000) return existing;
  let profile;
  try { profile = await client.getUserProfile(igsid); } catch { /* keep the last known profile */ }
  if (!profile && existing) return existing;
  const follower = await upsertFriend(db, {
    igsid, username: profile?.username ?? username ?? null, displayName: profile?.name ?? null,
    pictureUrl: profile?.profile_pic ?? null, isFollowing: profile?.is_user_follow_business ?? false,
    followerCount: profile?.follower_count ?? null, isVerified: profile?.is_verified_user ?? false, accountId,
  });
  if (profile) await db.prepare('UPDATE followers SET profile_fetched_at=? WHERE id=?').bind(new Date().toISOString(), follower.id).run();
  return follower;
}

export async function handleMessagingEvent(
  db: D1Database,
  igClient: InstagramClient,
  event: MessagingEvent,
  workerUrl?: string,
  igAccount?: IgAccountRef,
  accountId?: string,
  observeOnly = false,
): Promise<void> {
  const senderId = event.sender.id;

  // Skip echo messages (our own outgoing messages)
  if (event.message?.is_echo) return;

  const follower = observeOnly
    ? (await getFriendByIgsid(db,senderId)) ?? await upsertFriend(db,{ igsid:senderId,accountId })
    : await getOrRefreshFollower(db, igClient, senderId, accountId);
  if (accountId && follower.account_id !== accountId) throw new Error('Follower account mismatch');
  // Use the event timestamp, not retry/processing time, to avoid extending the
  // messaging window when old webhooks are replayed or drain after downtime.
  if ((event.message || event.postback) && Number.isFinite(event.timestamp) && event.timestamp > 0 && event.timestamp <= Date.now() + 300_000) {
    const inbound = new Date(Math.min(event.timestamp, Date.now())).toISOString();
    await db.prepare(`UPDATE followers SET last_inbound_at=?,messaging_owner=? WHERE id=? AND (last_inbound_at IS NULL OR julianday(last_inbound_at)<=julianday(?))`).bind(inbound, observeOnly ? 'standby' : 'primary', follower.id, inbound).run();
  }

  if (observeOnly && (!Number.isFinite(event.timestamp) || event.timestamp <= 0 || event.timestamp > Date.now()+300_000)) await db.prepare("UPDATE followers SET messaging_owner='standby' WHERE id=?").bind(follower.id).run();
  const eligible = await messagingEligibility(db,follower.id,accountId);
  if (observeOnly || eligible !== 'eligible') {
    if (event.message || event.postback) await logMessage(db,{ followerId:follower.id,direction:'in',messageType:'text',triggerSource:null,body:JSON.stringify({ text:event.message?.text ?? event.postback?.title ?? '[attachment]', channel:observeOnly?'standby':'messaging' }) });
    return;
  }
  if (accountId) await resumeCommentJobs(db,follower.id,accountId);

  if (event.message?.text) {
    const incomingText = event.message.text;

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

    if (accountId && await resumeCommentGate(db,igClient,{id:follower.id,igsid:senderId},accountId,igAccount)) return;

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
                await processSingleDelivery(db,igClient,{...friendScenario,id:String(friendScenario.id),follower_id:String(friendScenario.follower_id),scenario_id:String(friendScenario.scenario_id)},workerUrl,true);
              }
            }
            break;
          }
        }
      }
    }

  }

  if (event.message && !event.message.text) {
    await logMessage(db, { followerId: follower.id, direction: 'in', messageType: 'text', body: JSON.stringify({ text: '[attachment]' }), triggerSource: null });
    if (accountId && await resumeCommentGate(db, igClient, { id: follower.id, igsid: senderId }, accountId, igAccount)) return;
  }

  if (event.message?.attachments?.some((attachment) => attachment.type === 'story_mention')) {
    await handleMentionEvent(db, igClient, { mentioned_user_id: senderId }, igAccount, accountId);
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
  value: { id: string; text: string; from: { id: string; username: string }; media: { id: string; media_product_type?: string }; created_time?: string },
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

  // Comment-only users need no messaging-profile lookup before their private reply.
  const follower = (await getFriendByIgsid(db,senderId)) ?? await upsertFriend(db,{ igsid:senderId,username:value.from.username,accountId });
  if (accountId && follower.account_id !== accountId) throw new Error('Follower account mismatch');

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
      commentCreatedAt: value.created_time,
      isLive: value.media.media_product_type === 'LIVE',
      commenterUsername: value.from?.username,
      igAccount,
      accountId,
    });
  } catch (err) {
    // A matched gate owns this comment. Never fall through to a second sender.
    throw err;
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
      if (!accountId) throw new Error('Comment rule requires an account');
      const expandedBody = rule.response_body
        .replace(/\{\{igsid\}\}/g, senderId)
        .replace(/\{\{username\}\}/g, value.from.username)
        .replace(/\{\{follower_id\}\}/g, String(follower.id));
      const replyText = (rule as { reply_text?: string }).reply_text?.replace('{{username}}', value.from.username)
        ?? `@${value.from.username} コメントありがとう！📩 DMを送りました！`;
      await enqueueCommentRuleJob(db, {
        accountId, ruleId: rule.id, commentId: value.id, followerId: follower.id,
        messageType: rule.response_type, body: expandedBody, replyText, delaySeconds: rule.delay_seconds, mediaId, commentCreatedAt: value.created_time, isLive: value.media.media_product_type === 'LIVE',
      });

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
          const enrollment = await enrollFriendInScenario(db, follower.id, scenario.id);
          await db.prepare("UPDATE follower_scenarios SET next_step_at=NULL,end_reason='awaiting_inbound' WHERE id=? AND status='active'").bind(enrollment.id).run();
        }
      }
    }
  }

}

// ── Story/Post Mention Handler ──
async function handleMentionEvent(
  db: D1Database,
  igClient: InstagramClient,
  value: { media_id?: string; comment_id?: string; mentioned_user_id?: string },
  igAccount?: IgAccountRef,
  accountId?: string,
): Promise<void> {
  // When someone mentions us in their story, send them a DM
  const mentionerId = (value as any).from?.id ?? (value as any).mentioned_user_id;
  if (!mentionerId) return;

  const mentionerUsername = (value as any).from?.username ?? 'friend';

  // Upsert follower
  const follower = await upsertFriend(db, {
    igsid: mentionerId,
    username: mentionerUsername,
    displayName: null,
    pictureUrl: null,
    accountId,
  });

  // A caption/media mention is not itself an inbound DM.
  if (await messagingEligibility(db,follower.id,accountId) !== 'eligible') return;

  // Engagement gate trigger (story_mention) — fires before the legacy thank-you DM
  // so a configured campaign takes precedence over the hard-coded reply.
  try {
    const triggered = await triggerGateForStoryMention(db, igClient, {
      follower: { id: follower.id, igsid: mentionerId },
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
      .bind(follower.id, JSON.stringify({ text: `ストーリーズメンション自動返信 to @${mentionerUsername}` }))
      .run();
  } catch (err) {
    console.error('Mention DM failed:', err);
  }
}

export { webhook };
