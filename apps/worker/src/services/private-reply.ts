import { InstagramApiError } from '@ig-harness/ig-sdk';
export type PrivateReplyClient = {
    sendPrivateReply(commentId: string, text: string): Promise<{
        message_id?: string;
    }>;
    getCommentTimestamp(commentId: string): Promise<string>;
};
export class PrivateReplyNotAttemptedError extends Error {
    constructor(public readonly original: unknown) { super('Could not verify comment creation time'); this.name = 'PrivateReplyNotAttemptedError'; }
}
/** Claim before the external call. A timeout/5xx is not proof of non-delivery. */
export async function sendCommentPrivateReply(db: D1Database, client: PrivateReplyClient, input: {
    accountId: string;
    followerId: number;
    commentId: string;
    text: string;
    createdAt?: string | null;
    isLive?: boolean;
}): Promise<'sent' | 'already_sent' | 'outcome_unknown' | 'rejected' | 'expired' | 'standby'> {
    if (input.isLive)
        throw new Error('Live-comment replies are not enabled; broadcast liveness must be verified first');
    if (!input.commentId || !input.text || input.text.length > 1000)
        throw new PrivateReplyNotAttemptedError(new Error('Private reply requires a comment ID and 1..1000 characters'));
    const existing = await db.prepare('SELECT status,error_code FROM private_reply_attempts WHERE account_id=? AND comment_id=?').bind(input.accountId, input.commentId).first<{
        status: string;
        error_code: number | null;
    }>();
    const retryRateLimit = existing?.status === 'failed' && [4, 17, 32, 613, 80002, 429].includes(existing.error_code ?? -1);
    if (existing && !retryRateLimit)
        return existing.status === 'sent' ? 'already_sent' : existing.status === 'failed' ? 'rejected' : 'outcome_unknown';
    const owner = await db.prepare('SELECT messaging_owner FROM followers WHERE id=? AND account_id=?').bind(input.followerId, input.accountId).first<{
        messaging_owner: string;
    }>();
    if (!owner || owner.messaging_owner === 'standby')
        return 'standby';
    let created = input.createdAt;
    if (!created || !Number.isFinite(Date.parse(created))) {
        try {
            created = await client.getCommentTimestamp(input.commentId);
        }
        catch (error) {
            throw new PrivateReplyNotAttemptedError(error);
        }
    }
    const time = Date.parse(created);
    if (!Number.isFinite(time) || time > Date.now() || time <= Date.now() - 7 * 86400000)
        return 'expired';
    const claim = retryRateLimit
        ? await db.prepare("UPDATE private_reply_attempts SET status='processing',attempted_at=? WHERE account_id=? AND comment_id=? AND status='failed' AND error_code IN (4,17,32,613,80002,429)").bind(new Date().toISOString(), input.accountId, input.commentId).run()
        : await db.prepare(`INSERT OR IGNORE INTO private_reply_attempts(account_id,comment_id,follower_id,status,attempted_at) VALUES(?,?,?,'processing',?)`).bind(input.accountId, input.commentId, input.followerId, new Date().toISOString()).run();
    if (!claim.meta.changes)
        return 'outcome_unknown';
    let result;
    try {
        result = await client.sendPrivateReply(input.commentId, input.text);
    }
    catch (error) {
        const rejected = error instanceof InstagramApiError && error.status < 500;
        await db.prepare('UPDATE private_reply_attempts SET status=?,error_code=?,error_subcode=? WHERE account_id=? AND comment_id=?')
            .bind(rejected ? 'failed' : 'uncertain', error instanceof InstagramApiError ? (error.code ?? (error.status === 429 ? 429 : null)) : null, error instanceof InstagramApiError ? error.subcode ?? null : null, input.accountId, input.commentId).run();
        throw error;
    }
    await db.prepare("UPDATE private_reply_attempts SET status='sent',error_code=NULL,error_subcode=NULL,message_id=? WHERE account_id=? AND comment_id=?").bind(result.message_id ?? null, input.accountId, input.commentId).run();
    return 'sent';
}
