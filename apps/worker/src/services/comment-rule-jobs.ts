import type { InstagramClient } from '@ig-harness/ig-sdk';
import { deliveryFailure, sendIgMessage, validateBroadcastMessage } from './broadcast.js';

type CommentJob = { id: string; follower_id: number; igsid: string; comment_id: string; message_type: string; body: string; reply_text: string | null; expires_at: string };

export async function enqueueCommentRuleJob(db: D1Database, input: {
  accountId: string; ruleId: string; commentId: string; followerId: number;
  messageType: string; body: string; replyText: string | null; delaySeconds: number;
}): Promise<void> {
  if (!Number.isFinite(input.delaySeconds) || input.delaySeconds < 0 || input.delaySeconds > 86_400) throw new Error('Comment rule delay must be between 0 and 86400 seconds');
  validateBroadcastMessage(input.messageType, JSON.parse(input.body));
  // This legacy rule sends a normal DM, not a private reply. Therefore it must
  // have a real inbound messaging window. A comment alone does not open one.
  const follower = await db.prepare('SELECT last_inbound_at FROM followers WHERE id=? AND account_id=?').bind(input.followerId, input.accountId).first<{ last_inbound_at: string | null }>();
  const expiry = follower?.last_inbound_at ? Date.parse(follower.last_inbound_at) + 86_400_000 : 0;
  await db.prepare(`INSERT OR IGNORE INTO comment_rule_jobs
    (id, account_id, follower_id, comment_id, message_type, body, reply_text, due_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`${input.accountId}:${input.commentId}:${input.ruleId}`, input.accountId, input.followerId, input.commentId, input.messageType,
      input.body, input.replyText, new Date(Date.now() + input.delaySeconds * 1000).toISOString(), new Date(Number.isFinite(expiry) ? expiry : 0).toISOString()).run();
}

export async function processCommentRuleJobs(db: D1Database, client: InstagramClient, accountId: string): Promise<void> {
  await db.prepare("UPDATE comment_rule_jobs SET status='uncertain', reason='interrupted' WHERE account_id=? AND status='processing' AND julianday(started_at)<julianday(?)")
    .bind(accountId, new Date(Date.now() - 5 * 60_000).toISOString()).run();
  const rows = await db.prepare(`SELECT j.*, f.igsid FROM comment_rule_jobs j JOIN followers f ON f.id=j.follower_id AND f.account_id=j.account_id
    WHERE j.account_id=? AND j.status='pending' AND julianday(j.due_at)<=julianday(?) ORDER BY j.due_at LIMIT 5`)
    .bind(accountId, new Date().toISOString()).all<CommentJob>();
  const deadline = Date.now() + 15_000;
  for (const job of rows.results) {
    if (Date.now() >= deadline) break;
    const claim = await db.prepare("UPDATE comment_rule_jobs SET status='processing', started_at=? WHERE id=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM data_deletion_locks WHERE account_id=?) RETURNING id")
      .bind(new Date().toISOString(), job.id, accountId).first();
    if (!claim) continue;
    const eligible = await db.prepare('SELECT 1 FROM followers WHERE id=? AND account_id=? AND julianday(last_inbound_at)>julianday(?)')
      .bind(job.follower_id, accountId, new Date(Date.now() - 86_400_000).toISOString()).first();
    if (!eligible) {
      await db.prepare("UPDATE comment_rule_jobs SET status='skipped', reason='window_closed', finished_at=? WHERE id=?").bind(new Date().toISOString(), job.id).run();
      continue;
    }
    try { await sendIgMessage(client, job.igsid, job.message_type, JSON.parse(job.body)); }
    catch (error) {
      const failure = deliveryFailure(error);
      await db.prepare('UPDATE comment_rule_jobs SET status=?, reason=?, finished_at=? WHERE id=?').bind(failure.status, failure.reason, new Date().toISOString(), job.id).run();
      continue;
    }
    await db.batch([
      db.prepare("UPDATE comment_rule_jobs SET status='sent', finished_at=? WHERE id=?").bind(new Date().toISOString(), job.id),
      db.prepare("INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source) VALUES (?, 'out', ?, ?, 'comment_rule')").bind(job.follower_id, job.message_type, job.body),
    ]);
    // The public comment only promises delivery after the DM succeeded. A
    // failed public reply is never retried by replaying the already-sent DM.
    if (job.reply_text) {
      try { await client.replyToComment(job.comment_id, job.reply_text); }
      catch { await db.prepare("UPDATE comment_rule_jobs SET reason='public_reply_failed' WHERE id=?").bind(job.id).run(); }
    }
  }
}
