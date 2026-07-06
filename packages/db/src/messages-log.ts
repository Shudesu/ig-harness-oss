/**
 * Insert one row into messages_log.
 * Swallows all errors — logging must never break a DM send.
 * Also tolerates the old schema (CHECK violation before migration 0016).
 */
export async function logMessage(
  db: D1Database,
  opts: {
    followerId: number;
    direction: 'in' | 'out';
    messageType: 'text' | 'image' | 'template' | 'quick_reply';
    body: string;
    triggerSource: 'comment_rule' | 'scenario' | 'broadcast' | 'manual' | 'gate';
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(opts.followerId, opts.direction, opts.messageType, opts.body, opts.triggerSource)
      .run();
  } catch (err) {
    console.error('[logMessage] failed to insert message log:', err);
  }
}
