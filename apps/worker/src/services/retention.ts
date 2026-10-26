/** Retention is opt-in: existing deployments keep their promised history. */
export function retentionDays(value: string | undefined): number | null {
  if (!value || value === '0') return null;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 36500) throw new Error('MESSAGES_RETENTION_DAYS must be 0 (disabled) or 1..36500');
  return days;
}
export async function pruneExpiredMessages(db: D1Database, value?: string): Promise<void> {
  const days = retentionDays(value);
  if (days === null) return;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await db.prepare(`DELETE FROM messages_log WHERE id IN (
    SELECT id FROM messages_log WHERE julianday(created_at)<julianday(?) ORDER BY created_at LIMIT 100
  )`).bind(cutoff).run();
}
