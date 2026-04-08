import { jstNow } from './utils.js';

export interface Friend {
  id: number;
  igsid: string;
  username: string | null;
  name: string | null;
  profile_pic_url: string | null;
  external_user_id: string | null;
  is_following: number;
  follower_count: number | null;
  is_verified: number;
  score: number;
  metadata: string;
  first_seen_at: string;
  updated_at: string;
  // Backward compat aliases
  display_name: string | null;
  picture_url: string | null;
  created_at: string;
}

export interface GetFriendsOptions {
  limit?: number;
  offset?: number;
  tagId?: string;
}

export async function getFriends(
  db: D1Database,
  opts: GetFriendsOptions = {},
): Promise<Friend[]> {
  const { limit = 50, offset = 0, tagId } = opts;

  if (tagId) {
    const result = await db
      .prepare(
        `SELECT f.*
         FROM followers f
         INNER JOIN follower_tags ft ON ft.follower_id = f.id
         WHERE ft.tag_id = ?
         ORDER BY f.first_seen_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(tagId, limit, offset)
      .all<Friend>();
    return result.results;
  }

  const result = await db
    .prepare(
      `SELECT * FROM followers
       ORDER BY first_seen_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<Friend>();
  return result.results;
}

export async function getFriendByIgsid(
  db: D1Database,
  igsid: string,
): Promise<Friend | null> {
  return db
    .prepare(`SELECT * FROM followers WHERE igsid = ?`)
    .bind(igsid)
    .first<Friend>();
}

/** Backward compat alias */
export async function getFriendByLineUserId(
  db: D1Database,
  igsid: string,
): Promise<Friend | null> {
  return getFriendByIgsid(db, igsid);
}

export async function getFriendById(
  db: D1Database,
  id: string,
): Promise<Friend | null> {
  return db
    .prepare(`SELECT * FROM followers WHERE id = ?`)
    .bind(id)
    .first<Friend>();
}

export interface UpsertFriendInput {
  igsid: string;
  username?: string | null;
  displayName?: string | null;
  pictureUrl?: string | null;
  isFollowing?: boolean;
  followerCount?: number | null;
  isVerified?: boolean;
  // Legacy alias
  lineUserId?: string;
  statusMessage?: string | null;
}

export async function upsertFriend(
  db: D1Database,
  input: UpsertFriendInput,
): Promise<Friend> {
  const now = jstNow();
  const igsid = input.igsid || input.lineUserId!;
  const existing = await getFriendByIgsid(db, igsid);

  if (existing) {
    await db
      .prepare(
        `UPDATE followers
         SET username = ?,
             name = ?,
             profile_pic_url = ?,
             is_following = ?,
             follower_count = ?,
             is_verified = ?,
             updated_at = ?
         WHERE igsid = ?`,
      )
      .bind(
        input.username ?? existing.username,
        input.displayName ?? existing.name,
        input.pictureUrl ?? existing.profile_pic_url,
        input.isFollowing != null ? (input.isFollowing ? 1 : 0) : (existing as any).is_following ?? 0,
        input.followerCount ?? (existing as any).follower_count ?? null,
        input.isVerified != null ? (input.isVerified ? 1 : 0) : (existing as any).is_verified ?? 0,
        now,
        igsid,
      )
      .run();

    return (await getFriendByIgsid(db, igsid))!;
  }

  await db
    .prepare(
      `INSERT INTO followers (igsid, username, name, profile_pic_url, is_following, follower_count, is_verified, first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      igsid,
      input.username ?? null,
      input.displayName ?? null,
      input.pictureUrl ?? null,
      input.isFollowing ? 1 : 0,
      input.followerCount ?? null,
      input.isVerified ? 1 : 0,
      now,
      now,
    )
    .run();

  return (await getFriendByIgsid(db, igsid))!;
}

export async function updateFriendFollowStatus(
  db: D1Database,
  igsid: string,
  isFollowing: boolean,
): Promise<void> {
  await db
    .prepare(
      `UPDATE followers
       SET is_following = ?,
           updated_at = ?
       WHERE igsid = ?`,
    )
    .bind(isFollowing ? 1 : 0, jstNow(), igsid)
    .run();
}

export async function getFriendCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM followers`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
