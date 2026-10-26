import { InstagramApiError, InstagramTransportError, type InstagramClient } from '@ig-harness/ig-sdk';
import { deliveryFailure, sendIgMessage, validateBroadcastMessage } from './broadcast.js';
import { messagingEligibility } from './messaging-window.js';
import { sendCommentPrivateReply, PrivateReplyNotAttemptedError } from './private-reply.js';
type CommentJob = {
    id: string;
    follower_id: number;
    igsid: string;
    comment_id: string;
    message_type: string;
    body: string;
    reply_text: string | null;
    expires_at: string;
    delivery_mode: string;
    media_id: string | null;
    comment_created_at: string | null;
    gate_delivery_id: string | null;
    attempt_count: number;
};
export async function enqueueCommentRuleJob(db: D1Database, input: {
    accountId: string;
    ruleId: string;
    commentId: string;
    followerId: number;
    messageType: string;
    body: string;
    replyText: string | null;
    delaySeconds: number;
    mediaId?: string;
    commentCreatedAt?: string;
    gateDeliveryId?: string;
    isLive?: boolean;
}): Promise<void> {
    if (!Number.isFinite(input.delaySeconds) || input.delaySeconds < 0 || input.delaySeconds > 86400)
        throw new Error('Comment rule delay must be between 0 and 86400 seconds');
    validateBroadcastMessage(input.messageType, JSON.parse(input.body));
    const created = input.commentCreatedAt && Number.isFinite(Date.parse(input.commentCreatedAt)) ? input.commentCreatedAt : null;
    const statements = [db.prepare(`INSERT OR IGNORE INTO comment_rule_jobs
    (id,account_id,follower_id,comment_id,message_type,body,reply_text,due_at,expires_at,delivery_mode,media_id,comment_created_at,gate_delivery_id,status,reason)
    VALUES(?,?,?,?,?,?,?,?,?,'private_reply',?,?,?,?,?)`)
            .bind(`${input.accountId}:${input.commentId}:${input.ruleId}`, input.accountId, input.followerId, input.commentId, input.messageType, input.body, input.replyText, new Date(Date.now() + input.delaySeconds * 1000).toISOString(), created ? new Date(Date.parse(created) + 7 * 86400000).toISOString() : '9999-01-01T00:00:00Z', input.mediaId ?? null, created, input.gateDeliveryId ?? null, input.isLive ? 'skipped' : 'pending', input.isLive ? 'live_comment_not_supported' : null)];
    if (input.gateDeliveryId)
        statements.push(db.prepare("UPDATE gate_deliveries SET end_reason=NULL,metadata=json_set(metadata,'$.private_reply_queued',1) WHERE id=?").bind(input.gateDeliveryId));
    await db.batch(statements);
}
export async function resumeCommentJobs(db: D1Database, followerId: number, accountId: string): Promise<void> {
    await db.prepare("UPDATE comment_rule_jobs SET delivery_mode='dm_after_reply',due_at=?,reason=NULL WHERE follower_id=? AND account_id=? AND status='pending' AND delivery_mode='awaiting_inbound'")
        .bind(new Date().toISOString(), followerId, accountId).run();
    const waiting = await db.prepare("SELECT fs.id,fs.scenario_id FROM follower_scenarios fs JOIN scenarios s ON s.id=fs.scenario_id WHERE fs.follower_id=? AND s.account_id=? AND s.is_active=1 AND fs.status='active' AND fs.end_reason='awaiting_inbound'")
        .bind(followerId, accountId).all<{
        id: number;
        scenario_id: number;
    }>();
    for (const row of waiting.results) {
        const step = await db.prepare('SELECT delay_minutes FROM scenario_steps WHERE scenario_id=? ORDER BY step_order LIMIT 1').bind(row.scenario_id).first<{
            delay_minutes: number;
        }>();
        if (step)
            await db.prepare("UPDATE follower_scenarios SET next_step_at=?,end_reason=NULL WHERE id=? AND end_reason='awaiting_inbound'").bind(new Date(Date.now() + step.delay_minutes * 60000).toISOString(), row.id).run();
    }
}
export async function processCommentRuleJobs(db: D1Database, client: InstagramClient, accountId: string): Promise<void> {
    await db.prepare("UPDATE comment_rule_jobs SET status='uncertain', reason='interrupted' WHERE account_id=? AND status='processing' AND julianday(started_at)<julianday(?)").bind(accountId, new Date(Date.now() - 5 * 60000).toISOString()).run();
    const rows = await db.prepare(`SELECT j.*,f.igsid FROM comment_rule_jobs j JOIN followers f ON f.id=j.follower_id AND f.account_id=j.account_id
    WHERE j.account_id=? AND j.status='pending' AND j.delivery_mode!='awaiting_inbound' AND (j.gate_delivery_id IS NULL OR EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE d.id=j.gate_delivery_id AND g.status='active')) AND julianday(j.due_at)<=julianday(?) ORDER BY j.due_at LIMIT 5`)
        .bind(accountId, new Date().toISOString()).all<CommentJob>();
    const deadline = Date.now() + 15000;
    for (const job of rows.results) {
        if (Date.now() >= deadline)
            break;
        const claim = await db.prepare("UPDATE comment_rule_jobs SET status='processing',started_at=?,attempt_count=attempt_count+1 WHERE id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=?) AND (gate_delivery_id IS NULL OR EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE d.id=comment_rule_jobs.gate_delivery_id AND g.status='active')) RETURNING id").bind(new Date().toISOString(), job.id, accountId).first();
        if (!claim)
            continue;
        try {
            if (job.delivery_mode === 'private_reply') {
                const body = JSON.parse(job.body);
                const text = job.message_type === 'text' ? body.text : 'コメントありがとうございます。ご案内をお届けするため、このメッセージに返信してください。';
                const outcome = await sendCommentPrivateReply(db, client, { accountId, followerId: job.follower_id, commentId: job.comment_id, text, createdAt: job.comment_created_at });
                if (outcome !== 'sent') {
                    await db.prepare('UPDATE comment_rule_jobs SET status=?,reason=? WHERE id=?').bind(outcome === 'outcome_unknown' ? 'uncertain' : outcome === 'rejected' ? 'failed' : 'skipped', `private_reply_${outcome}`, job.id).run();
                    await recordGateFailure(db,job,`private_reply_${outcome}`,outcome==='expired' || outcome==='rejected' || outcome==='standby');
                continue;
                }
                const waiting = job.message_type !== 'text';
                await db.batch([
                    db.prepare("UPDATE comment_rule_jobs SET status=?,delivery_mode=?,reason=?,error_code=NULL,error_subcode=NULL,finished_at=? WHERE id=?").bind(waiting ? 'pending' : 'sent', waiting ? 'awaiting_inbound' : 'private_reply', waiting ? 'awaiting_inbound' : null, new Date().toISOString(), job.id),
                    db.prepare("INSERT INTO messages_log(follower_id,direction,message_type,body,trigger_source) VALUES(?,'out','text',?,?)").bind(job.follower_id, JSON.stringify({ text }), job.gate_delivery_id ? 'gate' : 'comment_rule'),
                    ...(job.gate_delivery_id ? [db.prepare("UPDATE gate_deliveries SET status='cta_sent',end_reason=NULL,metadata=json_set(metadata,'$.awaiting_reply',1,'$.comment_id',?) WHERE id=?").bind(job.comment_id, job.gate_delivery_id)] : []),
                ]);
            }
            else {
                const eligibility = await messagingEligibility(db, job.follower_id, accountId);
                if (eligibility !== 'eligible') {
                    await db.prepare("UPDATE comment_rule_jobs SET status='skipped',reason=? WHERE id=?").bind(eligibility, job.id).run();
                    continue;
                }
                await sendIgMessage(client, job.igsid, job.message_type, JSON.parse(job.body));
                await db.batch([
                    db.prepare("UPDATE comment_rule_jobs SET status='sent',error_code=NULL,error_subcode=NULL,reason=NULL,finished_at=? WHERE id=?").bind(new Date().toISOString(), job.id),
                    db.prepare("INSERT INTO messages_log(follower_id,direction,message_type,body,trigger_source) VALUES(?,'out',?,?,'comment_rule')").bind(job.follower_id, job.message_type, job.body),
                ]);
            }
        }
        catch (error) {
            const cause = error instanceof PrivateReplyNotAttemptedError ? error.original : error;
            const retry = (cause instanceof InstagramApiError && cause.status < 500 && cause.rateLimited) || (error instanceof PrivateReplyNotAttemptedError && (cause instanceof InstagramTransportError || cause instanceof InstagramApiError && cause.retryable));
            const failure = deliveryFailure(cause);
            const requeue = retry && job.attempt_count < 4;
            const wait = cause instanceof InstagramApiError && Number.isFinite(cause.retryAfterMs) ? Math.max(1000, cause.retryAfterMs!) : Math.min(3600000, 60000 * 2 ** job.attempt_count);
            await db.prepare('UPDATE comment_rule_jobs SET status=?,reason=?,error_code=?,error_subcode=?,due_at=? WHERE id=?')
                .bind(requeue ? 'pending' : error instanceof PrivateReplyNotAttemptedError ? 'failed' : failure.status, requeue ? 'rate_limited' : failure.reason, cause instanceof InstagramApiError ? cause.code ?? null : null, cause instanceof InstagramApiError ? cause.subcode ?? null : null, new Date(Date.now() + wait).toISOString(), job.id).run();
            await recordGateFailure(db,job,requeue?'rate_limited':failure.reason,!requeue && (error instanceof PrivateReplyNotAttemptedError || cause instanceof InstagramApiError && cause.status<500));
            continue;
        }
        if (job.reply_text && job.delivery_mode === 'private_reply') {
            try {
                // Keep each feature's existing public reply placement. Top-level
                // mentions do not bypass Meta permissions or App Review.
                if (job.gate_delivery_id && job.media_id)
                    await client.postCommentToMedia(job.media_id, job.reply_text);
                else
                    await client.replyToComment(job.comment_id, job.reply_text);
            }
            catch (error) {
                await db.prepare("UPDATE comment_rule_jobs SET reason='public_reply_failed',error_code=?,error_subcode=? WHERE id=?")
                    .bind(error instanceof InstagramApiError ? error.code ?? null : null, error instanceof InstagramApiError ? error.subcode ?? null : null, job.id).run();
            }
        }
    }
}

async function recordGateFailure(db:D1Database,job:CommentJob,reason:string,allowFreshComment:boolean):Promise<void> {
  if (!job.gate_delivery_id) return;
  await db.prepare("UPDATE gate_deliveries SET end_reason=?,metadata=json_set(metadata,'$.private_reply_queued',?) WHERE id=? AND status='triggered'").bind(reason,allowFreshComment?0:1,job.gate_delivery_id).run();
}
