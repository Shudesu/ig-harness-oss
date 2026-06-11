// packages/db/src/rich-messages.ts
//
// Rich messages: reusable structured DM templates for engagement gates.
// `blocks` is persisted as a JSON string; callers work with parsed objects.

import type { RichMessageBlock } from '@ig-harness/ig-sdk';

export type RichMessageKind = 'cta' | 'reward' | 'reminder' | 'generic';

export interface RichMessage {
  id: string;
  name: string;
  kind: RichMessageKind;
  blocks: RichMessageBlock[];
  created_at: string;
  updated_at: string;
}

interface RichMessageRow {
  id: string;
  name: string;
  kind: RichMessageKind;
  blocks: string;
  created_at: string;
  updated_at: string;
}

function parseRow(row: RichMessageRow | null): RichMessage | null {
  if (!row) return null;
  let blocks: RichMessageBlock[];
  try {
    blocks = JSON.parse(row.blocks) as RichMessageBlock[];
  } catch {
    blocks = [];
  }
  return { ...row, blocks };
}

export async function createRichMessage(
  db: D1Database,
  data: { name: string; kind: RichMessageKind; blocks: RichMessageBlock[]; accountId?: string },
): Promise<RichMessage> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO rich_messages (id, name, kind, blocks, account_id) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, data.name, data.kind, JSON.stringify(data.blocks), data.accountId ?? null)
    .run();
  const row = await db
    .prepare('SELECT * FROM rich_messages WHERE id = ?')
    .bind(id)
    .first<RichMessageRow>();
  const parsed = parseRow(row);
  if (!parsed) throw new Error('Failed to create rich_message');
  return parsed;
}

export async function getRichMessage(
  db: D1Database,
  id: string,
): Promise<RichMessage | null> {
  const row = await db
    .prepare('SELECT * FROM rich_messages WHERE id = ?')
    .bind(id)
    .first<RichMessageRow>();
  return parseRow(row);
}

export async function listRichMessages(
  db: D1Database,
  opts: { kind?: RichMessageKind; limit?: number; accountId?: string } = {},
): Promise<RichMessage[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.kind) {
    conditions.push('kind = ?');
    binds.push(opts.kind);
  }
  if (opts.accountId) {
    conditions.push('account_id = ?');
    binds.push(opts.accountId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const stmt = db.prepare(
    `SELECT * FROM rich_messages ${where} ORDER BY created_at DESC LIMIT ?`,
  );
  const result = await stmt.bind(...binds, limit).all<RichMessageRow>();
  return result.results.map((r) => parseRow(r)!).filter(Boolean);
}

export async function updateRichMessage(
  db: D1Database,
  id: string,
  patch: Partial<{ name: string; kind: RichMessageKind; blocks: RichMessageBlock[] }>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push('name = ?');
    values.push(patch.name);
  }
  if (patch.kind !== undefined) {
    fields.push('kind = ?');
    values.push(patch.kind);
  }
  if (patch.blocks !== undefined) {
    fields.push('blocks = ?');
    values.push(JSON.stringify(patch.blocks));
  }
  if (fields.length === 0) return;
  await db
    .prepare(
      `UPDATE rich_messages SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')) WHERE id = ?`,
    )
    .bind(...values, id)
    .run();
}

export async function deleteRichMessage(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare('DELETE FROM rich_messages WHERE id = ?').bind(id).run();
}

/**
 * Scans the blocks of a rich message for a postback button whose payload
 * starts with `CHECK_FOLLOW:`. Required for rich CTA messages on gates with
 * require_follow=1 — without it, handleFollowCheckPostback is never invoked
 * and the delivery gets stuck in `cta_sent`.
 */
export function hasCheckFollowPostback(blocks: RichMessageBlock[]): boolean {
  const buttons: Array<{ type: string; payload?: string }> = [];
  for (const block of blocks) {
    if (block.type === 'card') {
      for (const b of block.buttons) buttons.push(b);
    } else if (block.type === 'carousel') {
      for (const card of block.cards) {
        for (const b of card.buttons) buttons.push(b);
      }
    }
  }
  return buttons.some(
    (b) =>
      b.type === 'postback' &&
      typeof b.payload === 'string' &&
      b.payload.startsWith('CHECK_FOLLOW:'),
  );
}

/**
 * Returns every engagement gate that references the given rich_message_id
 * in any of the three slots. Used by delete_rich_message to refuse deletion
 * of in-use messages (force flag can override).
 */
export async function findGatesUsingRichMessage(
  db: D1Database,
  richMessageId: string,
): Promise<Array<{ id: string; name: string; slot: 'initial' | 'reward' | 'reminder' }>> {
  const result = await db
    .prepare(
      `SELECT id, name,
              initial_dm_rich_message_id AS initial,
              reward_dm_rich_message_id AS reward,
              follow_reminder_dm_rich_message_id AS reminder
       FROM engagement_gates
       WHERE initial_dm_rich_message_id = ?
          OR reward_dm_rich_message_id = ?
          OR follow_reminder_dm_rich_message_id = ?`,
    )
    .bind(richMessageId, richMessageId, richMessageId)
    .all<{ id: string; name: string; initial: string | null; reward: string | null; reminder: string | null }>();

  const out: Array<{ id: string; name: string; slot: 'initial' | 'reward' | 'reminder' }> = [];
  for (const r of result.results) {
    if (r.initial === richMessageId) out.push({ id: r.id, name: r.name, slot: 'initial' });
    if (r.reward === richMessageId) out.push({ id: r.id, name: r.name, slot: 'reward' });
    if (r.reminder === richMessageId) out.push({ id: r.id, name: r.name, slot: 'reminder' });
  }
  return out;
}
