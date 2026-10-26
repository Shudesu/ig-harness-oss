import { getBroadcastById } from '@ig-harness/db';
import type { Broadcast } from '@ig-harness/db';
import { InstagramApiError, type InstagramClient } from '@ig-harness/ig-sdk';
import { recordDmFailure } from '../lib/health.js';

const BATCH_SIZE = 10;
const WINDOW_MS = 24 * 60 * 60_000;

export function deliveryFailure(error: unknown): { status: 'failed' | 'uncertain'; reason: string } {
  if (error instanceof InstagramApiError && error.status < 500) {
    return { status: 'failed', reason: error.tokenExpired ? 'token_expired' : error.rateLimited ? 'rate_limited' : 'api_rejected' };
  }
  // Network failures / timeouts / 5xx cannot prove that Meta did not deliver.
  return { status: 'uncertain', reason: 'outcome_unknown' };
}

export async function broadcastSummary(db: D1Database, id: number | string) {
  return (await db.prepare(`SELECT status, reason, COUNT(*) AS count FROM broadcast_recipients WHERE broadcast_id=? GROUP BY status, reason`).bind(id).all<{ status: string; reason: string | null; count: number }>()).results;
}

export async function processBroadcastSend(
  db: D1Database, igClient: InstagramClient, broadcastId: number | string,
  _workerUrl?: string, accountId?: string,
): Promise<Broadcast> {
  let broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) throw new Error(`Broadcast ${broadcastId} not found`);
  if (!broadcast.account_id || (accountId && broadcast.account_id !== accountId)) throw new Error('Broadcast account mismatch');
  if (broadcast.status === 'sent') return broadcast;
  // Validate before claiming, then use the row returned by the atomic claim:
  // an edit may have won after our initial read. Editing/deleting helpers also
  // check status in SQL, so the claimed message stays immutable during resume.
  validateBroadcastMessage(broadcast.message_type, JSON.parse(broadcast.body));
  parseBroadcastTagFilter(broadcast.tag_filter);
  if (broadcast.status === 'draft' || broadcast.status === 'scheduled') {
    const claimed = await db.prepare("UPDATE broadcasts SET status='sending', updated_at=? WHERE id=? AND account_id=? AND status IN ('draft','scheduled') RETURNING *")
      .bind(new Date().toISOString(), broadcast.id, broadcast.account_id).first<Broadcast>();
    broadcast = claimed ?? await getBroadcastById(db, broadcast.id);
    if (!broadcast) throw new Error('Broadcast was deleted before delivery started');
    if (broadcast.status === 'sent') return broadcast;
    if (broadcast.status !== 'sending') throw new Error('Broadcast could not be claimed');
  }
  if (!broadcast.account_id || (accountId && broadcast.account_id !== accountId)) throw new Error('Broadcast account mismatch');
  const body = JSON.parse(broadcast.body) as Record<string, unknown>;
  validateBroadcastMessage(broadcast.message_type, body);
  const tagId = parseBroadcastTagFilter(broadcast.tag_filter);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  // A single transactional INSERT SELECT snapshots recipients in D1 without
  // loading the audience into Worker memory. A run marker handles empty runs.
  // Reentry never adds late followers or recipients who were already sent.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, follower_id, status, reason)
      SELECT ?, f.id,
        CASE WHEN julianday(f.last_inbound_at)>julianday(?) THEN 'pending' ELSE 'skipped' END,
        CASE WHEN julianday(f.last_inbound_at)>julianday(?) THEN NULL ELSE 'window_closed' END
      FROM followers f WHERE f.account_id=?
      ${tagId !== undefined ? 'AND EXISTS (SELECT 1 FROM follower_tags ft JOIN tags t ON t.id=ft.tag_id WHERE ft.follower_id=f.id AND ft.tag_id=? AND t.account_id=f.account_id)' : ''}
      AND NOT EXISTS (SELECT 1 FROM broadcast_runs WHERE broadcast_id=?)`)
      .bind(broadcast.id, cutoff, cutoff, broadcast.account_id, ...(tagId !== undefined ? [tagId] : []), broadcast.id),
    db.prepare('INSERT OR IGNORE INTO broadcast_runs (broadcast_id, started_at) VALUES (?, ?)').bind(broadcast.id, now),
    db.prepare("UPDATE broadcast_recipients SET status='uncertain', reason='interrupted' WHERE broadcast_id=? AND status='processing' AND julianday(attempted_at)<julianday(?)")
      .bind(broadcast.id, new Date(Date.now() - 5 * 60_000).toISOString()),
  ]);
  const recipients = await db.prepare(`SELECT r.follower_id, f.igsid FROM broadcast_recipients r JOIN followers f ON f.id=r.follower_id
    WHERE r.broadcast_id=? AND r.status='pending' AND f.account_id=? ORDER BY r.follower_id LIMIT ?`)
    .bind(broadcast.id, broadcast.account_id, BATCH_SIZE).all<{ follower_id: number; igsid: string }>();
  const deadline = Date.now() + 15_000;
  for (const recipient of recipients.results) {
    if (Date.now() >= deadline) break;
    // Recheck the window at send time, not just at audience snapshot time.
    const claimed = await db.prepare(`UPDATE broadcast_recipients SET status=CASE
      WHEN EXISTS (SELECT 1 FROM followers WHERE id=? AND julianday(last_inbound_at)>julianday(?)) THEN 'processing' ELSE 'skipped' END,
      reason=CASE WHEN EXISTS (SELECT 1 FROM followers WHERE id=? AND julianday(last_inbound_at)>julianday(?)) THEN NULL ELSE 'window_closed' END,
      attempted_at=? WHERE broadcast_id=? AND follower_id=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM data_deletion_locks WHERE account_id=?) RETURNING status`)
      .bind(recipient.follower_id, new Date(Date.now() - WINDOW_MS).toISOString(), recipient.follower_id, new Date(Date.now() - WINDOW_MS).toISOString(), new Date().toISOString(), broadcast.id, recipient.follower_id, broadcast.account_id)
      .first<{ status: string }>();
    if (claimed?.status !== 'processing') continue;
    try {
      await sendIgMessage(igClient, recipient.igsid, broadcast.message_type, body);
    } catch (error) {
      const failure = deliveryFailure(error);
      await db.prepare('UPDATE broadcast_recipients SET status=?, reason=? WHERE broadcast_id=? AND follower_id=? AND status=\'processing\'')
        .bind(failure.status, failure.reason, broadcast.id, recipient.follower_id).run();
      await recordDmFailure(db, broadcast.account_id).catch(() => {});
      continue;
    }
    // If recording fails after delivery, leave processing/uncertain. Never
    // reset the entire broadcast to draft or resend an ambiguous recipient.
    await db.batch([
      db.prepare("UPDATE broadcast_recipients SET status='sent', sent_at=? WHERE broadcast_id=? AND follower_id=? AND status='processing'").bind(new Date().toISOString(), broadcast.id, recipient.follower_id),
      db.prepare("INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source) VALUES (?, 'out', ?, ?, 'broadcast')").bind(recipient.follower_id, broadcast.message_type, broadcast.body),
      db.prepare("UPDATE broadcasts SET total_sent=(SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id=? AND status='sent') WHERE id=?").bind(broadcast.id, broadcast.id),
    ]);
  }
  await db.prepare(`UPDATE broadcasts SET status='sent', sent_at=?, updated_at=?
    WHERE id=? AND NOT EXISTS (SELECT 1 FROM broadcast_recipients WHERE broadcast_id=? AND status IN ('pending','processing'))`)
    .bind(new Date().toISOString(), new Date().toISOString(), broadcast.id, broadcast.id).run();
  return (await getBroadcastById(db, broadcast.id))!;
}

export async function processScheduledBroadcasts(db: D1Database, client: InstagramClient, workerUrl?: string, accountId?: string): Promise<void> {
  if (!accountId) return;
  const rows = await db.prepare(`SELECT id FROM broadcasts WHERE account_id=? AND
    (status='sending' OR (status='scheduled' AND julianday(scheduled_at)<=julianday(?))) ORDER BY updated_at, id LIMIT 3`)
    .bind(accountId, new Date().toISOString()).all<{ id: number }>();
  for (const row of rows.results) {
    try { await processBroadcastSend(db, client, row.id, workerUrl, accountId); }
    catch (error) { console.error(`Broadcast processing failed: ${row.id}`, error); }
  }
}

export function parseBroadcastTagFilter(raw: string | null | undefined): string | number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') throw new Error('tag_filter must be a JSON string');
  const tagId: unknown = JSON.parse(raw)?.tagId;
  if (typeof tagId === 'string' && tagId.trim()) return tagId;
  if (typeof tagId === 'number' && Number.isSafeInteger(tagId) && tagId > 0) return tagId;
  throw new Error('tag_filter must contain a valid tagId');
}

export function validateBroadcastMessage(type: string, body: Record<string, unknown>): void {
  if (!body || typeof body !== 'object') throw new Error('Invalid message body');
  if (type === 'text' && typeof body.text === 'string' && body.text.length > 0) return;
  if (type === 'image' && typeof body.url === 'string' && body.url.startsWith('https://')) return;
  if (type === 'template' && Array.isArray(body.elements) && body.elements.length > 0) return;
  if (type === 'quick_reply' && typeof body.text === 'string' && Array.isArray(body.quick_replies)) return;
  throw new Error('Invalid broadcast message type or body');
}

export async function sendIgMessage(client: InstagramClient, recipientId: string, type: string, body: Record<string, unknown>): Promise<void> {
  validateBroadcastMessage(type, body);
  switch (type) {
    case 'text': await client.sendText(recipientId, body.text as string); break;
    case 'image': await client.sendImage(recipientId, body.url as string); break;
    case 'template': await client.sendGenericTemplate(recipientId, body.elements as never[]); break;
    case 'quick_reply': await client.sendQuickReply(recipientId, body.text as string, body.quick_replies as never[]); break;
  }
}
