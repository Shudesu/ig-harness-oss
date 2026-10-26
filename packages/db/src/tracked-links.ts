import { jstNow } from './utils.js';
// =============================================================================
// Tracked Links — URL click tracking with automatic actions
// =============================================================================

export interface TrackedLink {
  id: string;
  name: string;
  original_url: string;
  tag_id: string | null;
  scenario_id: string | null;
  is_active: number;
  click_count: number;
  account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkClick {
  id: string;
  tracked_link_id: string;
  friend_id: string | null;
  clicked_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getTrackedLinks(
  db: D1Database,
  opts: { accountId?: string } = {},
): Promise<TrackedLink[]> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.accountId) {
    conditions.push('account_id = ?');
    binds.push(opts.accountId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(`SELECT CAST(id AS TEXT) AS id, name, destination_url AS original_url, CAST(tag_id AS TEXT) AS tag_id, CAST(scenario_id AS TEXT) AS scenario_id, is_active, click_count, account_id, created_at, updated_at FROM tracked_links ${where} ORDER BY created_at DESC`);
  const result = binds.length > 0
    ? await stmt.bind(...binds).all<TrackedLink>()
    : await stmt.all<TrackedLink>();
  return result.results;
}

export async function getTrackedLinkById(
  db: D1Database,
  id: string,
): Promise<TrackedLink | null> {
  return db
    .prepare(`SELECT CAST(id AS TEXT) AS id, name, destination_url AS original_url, CAST(tag_id AS TEXT) AS tag_id, CAST(scenario_id AS TEXT) AS scenario_id, is_active, click_count, account_id, created_at, updated_at FROM tracked_links WHERE id = ?`)
    .bind(id)
    .first<TrackedLink>();
}

export interface CreateTrackedLinkInput {
  name: string;
  originalUrl: string;
  tagId?: string | null;
  scenarioId?: string | null;
  /** Owning IG business account (ig_accounts.id). */
  accountId?: string;
}

export async function createTrackedLink(
  db: D1Database,
  input: CreateTrackedLinkInput,
): Promise<TrackedLink> {
  const now = jstNow();
  const inserted = await db.prepare(`INSERT INTO tracked_links
    (name,destination_url,ref_code,tag_id,scenario_id,is_active,click_count,account_id,created_at,updated_at)
    VALUES(?,?,?,?,?,1,0,?,?,?) RETURNING id`)
    .bind(input.name,input.originalUrl,crypto.randomUUID(),input.tagId ?? null,input.scenarioId ?? null,input.accountId ?? null,now,now)
    .first<{ id: number }>();
  if (!inserted) throw new Error('Tracked link creation failed');
  return (await getTrackedLinkById(db, String(inserted.id)))!;
}

export async function deleteTrackedLink(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tracked_links WHERE id = ?`).bind(id).run();
}

// ── Click Recording ───────────────────────────────────────────────────────────

export async function recordLinkClick(
  db: D1Database,
  trackedLinkId: string,
  friendId?: string | null,
): Promise<LinkClick> {
  const now = jstNow();
  const results = await db.batch([
    db.prepare('INSERT INTO link_clicks(link_id,follower_id,clicked_at) VALUES(?,?,?) RETURNING CAST(id AS TEXT) AS id, CAST(link_id AS TEXT) AS tracked_link_id, CAST(follower_id AS TEXT) AS friend_id, clicked_at').bind(trackedLinkId, friendId ?? null, now),
    db.prepare('UPDATE tracked_links SET click_count=click_count+1, updated_at=? WHERE id=?').bind(now, trackedLinkId),
  ]);
  return results[0]!.results[0] as unknown as LinkClick;
}

export interface LinkClickWithFriend extends LinkClick {
  friend_display_name: string | null;
}

export async function getLinkClicks(
  db: D1Database,
  trackedLinkId: string,
): Promise<LinkClickWithFriend[]> {
  const result = await db
    .prepare(
      `SELECT CAST(lc.id AS TEXT) AS id, CAST(lc.link_id AS TEXT) AS tracked_link_id, CAST(lc.follower_id AS TEXT) AS friend_id, lc.clicked_at, f.name as friend_display_name
       FROM link_clicks lc
       LEFT JOIN followers f ON f.id = lc.follower_id
       WHERE lc.link_id = ?
       ORDER BY lc.clicked_at DESC`,
    )
    .bind(trackedLinkId)
    .all<LinkClickWithFriend>();
  return result.results;
}
