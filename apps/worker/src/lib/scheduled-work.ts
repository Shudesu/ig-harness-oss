/** One bounded query replaces invoking every processor on every idle tick. */
export async function scheduledWork(db: D1Database, accountId: string) {
  return await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM follower_scenarios fs JOIN scenarios s ON s.id=fs.scenario_id WHERE s.account_id=? AND fs.status='active' AND julianday(fs.next_step_at)<=julianday(?)) AS steps,
    EXISTS(SELECT 1 FROM broadcasts WHERE account_id=? AND (status='sending' OR (status='scheduled' AND julianday(scheduled_at)<=julianday(?)))) AS broadcasts,
    EXISTS(SELECT 1 FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE g.account_id=? AND julianday(d.next_followup_at)<=julianday(?)) AS followups,
    EXISTS(SELECT 1 FROM media_posts WHERE account_id=? AND (status='processing' OR (status='scheduled' AND julianday(scheduled_at)<=julianday(?)))) AS media,
    EXISTS(SELECT 1 FROM webhook_events WHERE account_id=? AND status IN ('pending','processing')) AS webhooks,
    EXISTS(SELECT 1 FROM comment_rule_jobs WHERE account_id=? AND (status='processing' OR (status='pending' AND julianday(due_at)<=julianday(?)))) AS comments,
    EXISTS(SELECT 1 FROM data_deletion_locks WHERE account_id=?) AS deletion_locked`)
    .bind(accountId, new Date().toISOString(), accountId, new Date().toISOString(), accountId, new Date().toISOString(), accountId, new Date().toISOString(), accountId, accountId, new Date().toISOString(), accountId)
    .first<{ steps: number; broadcasts: number; followups: number; media: number; webhooks: number; comments: number; deletion_locked: number }>();
}
