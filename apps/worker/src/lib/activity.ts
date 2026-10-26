/** A deletion lock prevents new mutations; an existing mutation delays purge. */
export async function beginActivity(db: D1Database): Promise<string | null> {
  const id = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO active_mutations(id, started_at)
    SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM data_deletion_locks)`)
    .bind(id, new Date().toISOString()).run();
  return result.meta.changes ? id : null;
}
export async function endActivity(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM active_mutations WHERE id=?').bind(id).run();
}
