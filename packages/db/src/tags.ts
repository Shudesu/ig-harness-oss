import { jstNow } from './utils.js';
export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface FriendTag {
  follower_id: string;
  tag_id: string;
  assigned_at: string;
}

export async function getTags(
  db: D1Database,
  opts: { accountId?: string } = {},
): Promise<Tag[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.accountId) {
    conditions.push('account_id = ?');
    binds.push(opts.accountId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(`SELECT * FROM tags ${where} ORDER BY name ASC`);
  const result = binds.length > 0
    ? await stmt.bind(...binds).all<Tag>()
    : await stmt.all<Tag>();
  return result.results;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  /** Owning IG business account (ig_accounts.id). */
  accountId?: string;
}

export async function createTag(
  db: D1Database,
  input: CreateTagInput,
): Promise<Tag> {
  const color = input.color ?? '#3B82F6';

  const result = await db
    .prepare(
      `INSERT INTO tags (name, color, account_id) VALUES (?, ?, ?) RETURNING *`,
    )
    .bind(input.name, color, input.accountId ?? null)
    .first<Tag>();

  return result!;
}

export async function deleteTag(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run();
}

export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO follower_tags (follower_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, now)
    .run();
}

export async function removeTagFromFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM follower_tags WHERE follower_id = ? AND tag_id = ?`,
    )
    .bind(friendId, tagId)
    .run();
}

export async function getFriendTags(
  db: D1Database,
  // followers.id is numeric in SQLite; route params arrive as string. Both
  // bind cleanly through D1.
  friendId: string | number,
): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.*
       FROM tags t
       INNER JOIN follower_tags ft ON ft.tag_id = t.id
       WHERE ft.follower_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(friendId)
    .all<Tag>();
  return result.results;
}

import type { Friend } from './friends';

export async function getFriendsByTag(
  db: D1Database,
  tagId: string,
  opts: { accountId?: string } = {},
): Promise<Friend[]> {
  const accountFilter = opts.accountId ? 'AND f.account_id = ?' : '';
  const stmt = db.prepare(
    `SELECT f.*
     FROM followers f
     INNER JOIN follower_tags ft ON ft.follower_id = f.id
     WHERE ft.tag_id = ? ${accountFilter}
     ORDER BY f.first_seen_at DESC`,
  );
  const result = opts.accountId
    ? await stmt.bind(tagId, opts.accountId).all<Friend>()
    : await stmt.bind(tagId).all<Friend>();
  return result.results;
}
