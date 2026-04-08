import { jstNow } from './utils.js';
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent';
export type BroadcastMessageType = 'text' | 'image' | 'template' | 'quick_reply';

export interface Broadcast {
  id: number;
  name: string;
  message_type: BroadcastMessageType;
  body: string;
  tag_filter: string | null;
  status: BroadcastStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  total_sent: number;
  created_at: string;
  updated_at: string;
}

export async function getBroadcasts(db: D1Database): Promise<Broadcast[]> {
  const result = await db
    .prepare(`SELECT * FROM broadcasts ORDER BY created_at DESC`)
    .all<Broadcast>();
  return result.results;
}

export async function getBroadcastById(
  db: D1Database,
  id: number | string,
): Promise<Broadcast | null> {
  return db
    .prepare(`SELECT * FROM broadcasts WHERE id = ?`)
    .bind(id)
    .first<Broadcast>();
}

export interface CreateBroadcastInput {
  name: string;
  messageType: BroadcastMessageType;
  body: string;
  tagFilter?: string | null;
  scheduledAt?: string | null;
}

export async function createBroadcast(
  db: D1Database,
  input: CreateBroadcastInput,
): Promise<Broadcast> {
  const now = jstNow();
  const initialStatus: BroadcastStatus = input.scheduledAt ? 'scheduled' : 'draft';

  const result = await db
    .prepare(
      `INSERT INTO broadcasts
         (name, message_type, body, tag_filter, status, scheduled_at, sent_at, total_sent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
       RETURNING *`,
    )
    .bind(
      input.name,
      input.messageType,
      input.body,
      input.tagFilter ?? null,
      initialStatus,
      input.scheduledAt ?? null,
      now,
      now,
    )
    .first<Broadcast>();

  return result!;
}

export type UpdateBroadcastInput = Partial<
  Pick<
    Broadcast,
    | 'name'
    | 'message_type'
    | 'body'
    | 'tag_filter'
    | 'status'
    | 'scheduled_at'
  >
>;

export async function updateBroadcast(
  db: D1Database,
  id: number | string,
  updates: UpdateBroadcastInput,
): Promise<Broadcast | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.message_type !== undefined) {
    fields.push('message_type = ?');
    values.push(updates.message_type);
  }
  if (updates.body !== undefined) {
    fields.push('body = ?');
    values.push(updates.body);
  }
  if (updates.tag_filter !== undefined) {
    fields.push('tag_filter = ?');
    values.push(updates.tag_filter);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.scheduled_at !== undefined) {
    fields.push('scheduled_at = ?');
    values.push(updates.scheduled_at);
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(jstNow());
    values.push(id);
    await db
      .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return getBroadcastById(db, id);
}

export async function deleteBroadcast(db: D1Database, id: number | string): Promise<void> {
  await db.prepare(`DELETE FROM broadcasts WHERE id = ?`).bind(id).run();
}

export interface BroadcastStatusCounts {
  totalSent?: number;
}

export async function updateBroadcastStatus(
  db: D1Database,
  id: number | string,
  status: BroadcastStatus,
  counts?: BroadcastStatusCounts,
): Promise<void> {
  const fields: string[] = ['status = ?', 'updated_at = ?'];
  const values: unknown[] = [status, jstNow()];

  if (status === 'sent') {
    fields.push('sent_at = ?');
    values.push(jstNow());
  }
  if (counts?.totalSent !== undefined) {
    fields.push('total_sent = ?');
    values.push(counts.totalSent);
  }

  values.push(id);
  await db
    .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}
