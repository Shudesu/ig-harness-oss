import { sha256 } from '../lib/security.js';

export type QueuedEvent = { account_id: string; event_key: string; kind: string; payload: string; subject_id: string | null };

export async function eventKey(kind: string, value: Record<string, any>): Promise<string | null> {
  if (kind === 'messaging' || kind === 'standby') {
    if (value.message?.is_echo || (!value.message && !value.postback)) return null;
    const mid = value.message?.mid ?? value.postback?.mid;
    return mid ? `${kind === 'standby' ? 'standby' : 'message'}:${await sha256(String(mid))}` : `postback:${await sha256(JSON.stringify(value))}`;
  }
  if (kind === 'comments' && value.id) return `comment:${await sha256(String(value.id))}`;
  if (kind === 'mentions') return `mention:${await sha256(JSON.stringify(value))}`;
  return null;
}

export async function queueWebhookEvents(db: D1Database, accountId: string, events: Array<{ kind: string; value: Record<string, any> }>): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const event of events) {
    const key = await eventKey(event.kind, event.value);
    if (!key) continue;
    statements.push(db.prepare(`INSERT OR IGNORE INTO webhook_events
      (account_id, event_key, kind, payload, subject_id, status, received_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(accountId, key, event.kind, JSON.stringify(event.value), event.value.sender?.id ?? event.value.from?.id ?? event.value.mentioned_user_id ?? null, new Date().toISOString()));
  }
  // Keep each batch below D1's variable/query budget, even for large deliveries.
  for (let i = 0; i < statements.length; i += 25) await db.batch(statements.slice(i, i + 25));
}

export async function drainWebhookEvents(db: D1Database, accountId: string, handle: (event: QueuedEvent) => Promise<void>): Promise<void> {
  await db.prepare("UPDATE webhook_events SET status='uncertain' WHERE account_id=? AND status='processing' AND julianday(started_at)<julianday(?)")
    .bind(accountId, new Date(Date.now() - 5 * 60_000).toISOString()).run();
  const events = await db.prepare("SELECT account_id,event_key,kind,payload,subject_id FROM webhook_events WHERE account_id=? AND status='pending' ORDER BY received_at LIMIT 5")
    .bind(accountId).all<QueuedEvent>();
  const deadline = Date.now() + 15_000;
  for (const event of events.results) {
    if (Date.now() >= deadline) break;
    const claim = await db.prepare(`UPDATE webhook_events SET status='processing', started_at=? WHERE account_id=? AND event_key=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM data_deletion_locks WHERE account_id=?) RETURNING event_key`)
      .bind(new Date().toISOString(), accountId, event.event_key, accountId).first();
    if (!claim) continue;
    try {
      await handle(event);
      await db.prepare("UPDATE webhook_events SET status='completed', payload=NULL, finished_at=? WHERE account_id=? AND event_key=?")
        .bind(new Date().toISOString(), accountId, event.event_key).run();
    } catch (error) {
      await db.prepare("UPDATE webhook_events SET status='uncertain', finished_at=? WHERE account_id=? AND event_key=?")
        .bind(new Date().toISOString(), accountId, event.event_key).run();
      console.error('Webhook event requires delivery review', { accountId, eventKey: event.event_key });
    }
  }
}
