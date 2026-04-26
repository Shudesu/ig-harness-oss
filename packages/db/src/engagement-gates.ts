// packages/db/src/engagement-gates.ts

export interface EngagementGate {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  trigger_type: 'comment_on_post' | 'dm_keyword' | 'story_mention';
  target_post_id: string | null;
  trigger_keyword: string | null;
  require_follow: number;
  initial_dm_text: string;
  initial_dm_button_label: string;
  follow_reminder_dm_text: string;
  follow_reminder_button_label: string;
  reward_dm_text: string;
  reward_url: string | null;
  max_loops: number;
  initial_dm_rich_message_id: string | null;
  reward_dm_rich_message_id: string | null;
  follow_reminder_dm_rich_message_id: string | null;
  comment_reply_text: string | null;
  /** JSON-serialized FollowupDmStep[]. Empty / NULL = no 24h drip. */
  followup_dm_sequence: string | null;
  /** When 1, every matching trigger creates a new delivery and the
   *  service skips the "already triggered" early-return — the same
   *  follower can receive the CTA flow repeatedly. Default 0
   *  (idempotent: 1 follower × 1 gate = 1 delivery). */
  allow_repeat: number;
  /**
   * LINE Harness multi-connection binding. When the operator picks a
   * connection + pool in the campaign wizard, we rewrite outbound reward /
   * CTA / reminder links through a LINE Harness tracked link so a click
   * captures the IG ↔ LINE userId pair. `line_tracked_link_short` is the
   * cached tracked-link id created lazily on first delivery — keeping it
   * on the gate (instead of per delivery) avoids one `POST /api/tracked-links`
   * call per recipient.
   */
  line_connection_id: string | null;
  line_pool_slug: string | null;
  line_tracked_link_short: string | null;
  /**
   * Hydrated list of IG media ids this gate targets (via gate_target_posts
   * junction). Empty array = "applies to all posts". Only populated by the
   * route/service layer after a row is fetched; the column itself lives on
   * a separate table, so db-level INSERT/UPDATE helpers don't touch it.
   */
  target_post_ids?: string[];
  created_at: string;
  updated_at: string;
}

/** One step in a reward follow-up drip. Text is required; image_url /
 *  button_label / button_url are optional and only render when all
 *  button fields are present. */
export interface FollowupDmStep {
  delay_minutes: number;
  text: string;
  image_url?: string;
  button_label?: string;
  button_url?: string;
}

export function parseFollowupSequence(raw: string | null | undefined): FollowupDmStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is FollowupDmStep =>
        x && typeof x === 'object' && typeof x.text === 'string' && typeof x.delay_minutes === 'number',
    );
  } catch {
    return [];
  }
}

export interface GateDelivery {
  id: string;
  gate_id: string;
  follower_id: number;
  igsid: string;
  status: 'triggered' | 'cta_sent' | 'pending_follow' | 'delivered' | 'dropped';
  loop_count: number;
  last_check_at: string | null;
  triggered_at: string;
  delivered_at: string | null;
  followup_step_sent: number;
  next_followup_at: string | null;
  metadata: string;
}

export async function createEngagementGate(
  db: D1Database,
  gate: Omit<EngagementGate, 'id' | 'created_at' | 'updated_at'>,
): Promise<EngagementGate> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO engagement_gates
       (id, name, status, trigger_type, target_post_id, trigger_keyword,
        require_follow, initial_dm_text, initial_dm_button_label,
        follow_reminder_dm_text, follow_reminder_button_label,
        reward_dm_text, reward_url, max_loops,
        initial_dm_rich_message_id, reward_dm_rich_message_id,
        follow_reminder_dm_rich_message_id, comment_reply_text,
        followup_dm_sequence,
        line_connection_id, line_pool_slug, allow_repeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, gate.name, gate.status, gate.trigger_type, gate.target_post_id,
      gate.trigger_keyword, gate.require_follow, gate.initial_dm_text,
      gate.initial_dm_button_label, gate.follow_reminder_dm_text,
      gate.follow_reminder_button_label, gate.reward_dm_text,
      gate.reward_url, gate.max_loops,
      gate.initial_dm_rich_message_id ?? null,
      gate.reward_dm_rich_message_id ?? null,
      gate.follow_reminder_dm_rich_message_id ?? null,
      gate.comment_reply_text ?? null,
      gate.followup_dm_sequence ?? null,
      gate.line_connection_id ?? null,
      gate.line_pool_slug ?? null,
      gate.allow_repeat ?? 0,
    )
    .run();
  const row = await db
    .prepare('SELECT * FROM engagement_gates WHERE id = ?')
    .bind(id)
    .first<EngagementGate>();
  if (!row) throw new Error('Failed to create engagement gate');
  return row;
}

export async function listEngagementGates(
  db: D1Database,
  opts: { activeOnly?: boolean } = {},
): Promise<EngagementGate[]> {
  const where = opts.activeOnly ? "WHERE status = 'active'" : '';
  const result = await db
    .prepare(`SELECT * FROM engagement_gates ${where} ORDER BY created_at DESC`)
    .all<EngagementGate>();
  const gates = result.results;

  // Hydrate target_post_ids in a single roundtrip.
  if (gates.length > 0) {
    const posts = await db
      .prepare(`SELECT gate_id, post_id FROM gate_target_posts`)
      .all<{ gate_id: string; post_id: string }>();
    const byGate = new Map<string, string[]>();
    for (const row of posts.results) {
      const arr = byGate.get(row.gate_id) ?? [];
      arr.push(row.post_id);
      byGate.set(row.gate_id, arr);
    }
    for (const g of gates) g.target_post_ids = byGate.get(g.id) ?? [];
  }
  return gates;
}

export async function getEngagementGate(
  db: D1Database,
  id: string,
): Promise<EngagementGate | null> {
  const row = await db
    .prepare('SELECT * FROM engagement_gates WHERE id = ?')
    .bind(id)
    .first<EngagementGate>();
  if (!row) return null;
  row.target_post_ids = await getGateTargetPosts(db, id);
  return row;
}

export async function getGateTargetPosts(
  db: D1Database,
  gateId: string,
): Promise<string[]> {
  const result = await db
    .prepare('SELECT post_id FROM gate_target_posts WHERE gate_id = ? ORDER BY created_at ASC')
    .bind(gateId)
    .all<{ post_id: string }>();
  return result.results.map((r) => r.post_id);
}

/**
 * Replace the gate's target post list with the given ids (transaction-ish:
 * we delete existing rows first, then insert new ones). Empty array = apply
 * to all posts (no rows in the junction).
 */
export async function setGateTargetPosts(
  db: D1Database,
  gateId: string,
  postIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(postIds.map((p) => p.trim()).filter(Boolean)));
  await db.prepare('DELETE FROM gate_target_posts WHERE gate_id = ?').bind(gateId).run();
  if (unique.length === 0) return;
  // D1 can't batch inserts easily without prepared+bind loops; loop is fine
  // for the expected N ≤ ~100 per gate.
  for (const pid of unique) {
    await db
      .prepare('INSERT OR IGNORE INTO gate_target_posts (gate_id, post_id) VALUES (?, ?)')
      .bind(gateId, pid)
      .run();
  }
}

/**
 * Given a post id, return the gate ids that already target it. Used by the
 * wizard's media picker to show "このリールは既に N キャンペーン適用中" badges.
 */
export async function findGatesTargetingPost(
  db: D1Database,
  postId: string,
): Promise<string[]> {
  const result = await db
    .prepare('SELECT gate_id FROM gate_target_posts WHERE post_id = ?')
    .bind(postId)
    .all<{ gate_id: string }>();
  return result.results.map((r) => r.gate_id);
}

// Whitelist of columns allowed in PATCH. Filtering protects against SQL
// injection via field names AND lets callers safely round-trip a full gate
// row (including read-only or computed fields like `analytics`, `created_at`)
// without crashing the UPDATE statement.
const UPDATABLE_GATE_FIELDS = [
  'name',
  'status',
  'trigger_type',
  'target_post_id',
  'trigger_keyword',
  'require_follow',
  'initial_dm_text',
  'initial_dm_button_label',
  'follow_reminder_dm_text',
  'follow_reminder_button_label',
  'reward_dm_text',
  'reward_url',
  'max_loops',
  'initial_dm_rich_message_id',
  'reward_dm_rich_message_id',
  'follow_reminder_dm_rich_message_id',
  'comment_reply_text',
  'followup_dm_sequence',
  'line_connection_id',
  'line_pool_slug',
  'line_tracked_link_short',
  'allow_repeat',
] as const;

export async function updateEngagementGate(
  db: D1Database,
  id: string,
  patch: Partial<Omit<EngagementGate, 'id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const fields = Object.keys(patch).filter((f) =>
    (UPDATABLE_GATE_FIELDS as readonly string[]).includes(f),
  );
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (patch as Record<string, unknown>)[f]);
  await db
    .prepare(
      `UPDATE engagement_gates SET ${setClause}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')) WHERE id = ?`,
    )
    .bind(...values, id)
    .run();
}

export async function deleteEngagementGate(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare('DELETE FROM engagement_gates WHERE id = ?').bind(id).run();
}

export async function createGateDelivery(
  db: D1Database,
  data: {
    gate_id: string;
    follower_id: number;
    igsid: string;
    metadata?: object;
    /** Pass `gate.allow_repeat` here. When 1, this helper always inserts a
     *  new delivery row instead of reusing the existing per-follower row.
     *  Migration 0013 dropped the unique index, so concurrent rows are
     *  allowed at the DB level. */
    allow_repeat?: number;
  },
): Promise<GateDelivery> {
  const id = crypto.randomUUID();

  // allow_repeat=1: always create a brand-new delivery so the same follower
  // can receive the CTA flow again. Used for demo / nurture campaigns.
  if (data.allow_repeat === 1) {
    await db
      .prepare(
        `INSERT INTO gate_deliveries (id, gate_id, follower_id, igsid, metadata)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, data.gate_id, data.follower_id, data.igsid, JSON.stringify(data.metadata ?? {}))
      .run();
    const row = await db
      .prepare('SELECT * FROM gate_deliveries WHERE id = ?')
      .bind(id)
      .first<GateDelivery>();
    if (!row) throw new Error('Failed to create gate delivery');
    return row;
  }

  // allow_repeat=0 (legacy idempotent): SELECT existing row first; only
  // INSERT if none exists. Race-tolerant: 2 concurrent webhooks may produce
  // 2 rows in the worst case, but we no longer rely on the unique index
  // (dropped in migration 0013) for correctness.
  const existing = await db
    .prepare('SELECT * FROM gate_deliveries WHERE gate_id = ? AND follower_id = ? LIMIT 1')
    .bind(data.gate_id, data.follower_id)
    .first<GateDelivery>();
  if (existing) return existing;

  await db
    .prepare(
      `INSERT INTO gate_deliveries (id, gate_id, follower_id, igsid, metadata)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, data.gate_id, data.follower_id, data.igsid, JSON.stringify(data.metadata ?? {}))
    .run();
  const row = await db
    .prepare('SELECT * FROM gate_deliveries WHERE id = ?')
    .bind(id)
    .first<GateDelivery>();
  if (!row) throw new Error('Failed to create gate delivery');
  return row;
}

export async function getGateDelivery(
  db: D1Database,
  id: string,
): Promise<GateDelivery | null> {
  return await db
    .prepare('SELECT * FROM gate_deliveries WHERE id = ?')
    .bind(id)
    .first<GateDelivery>();
}

export async function updateGateDelivery(
  db: D1Database,
  id: string,
  patch: {
    status?: GateDelivery['status'];
    loop_count?: number;
    delivered_at?: string | null;
    last_check_at?: string | null;
    followup_step_sent?: number;
    next_followup_at?: string | null;
  },
): Promise<void> {
  const fields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (patch as Record<string, unknown>)[f]);
  await db
    .prepare(`UPDATE gate_deliveries SET ${setClause} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

export async function listGateDeliveries(
  db: D1Database,
  gateId: string,
): Promise<GateDelivery[]> {
  const result = await db
    .prepare('SELECT * FROM gate_deliveries WHERE gate_id = ? ORDER BY triggered_at DESC')
    .bind(gateId)
    .all<GateDelivery>();
  return result.results;
}

export async function getGateAnalytics(
  db: D1Database,
  gateId: string,
): Promise<{
  triggered: number;
  cta_sent: number;
  pending_follow: number;
  delivered: number;
  dropped: number;
  follow_rate: number;
  line_linked: number;
  clicks_total: number;
  clicks_unique: number;
}> {
  const counts = await db
    .prepare(
      `SELECT status, COUNT(*) as n FROM gate_deliveries WHERE gate_id = ? GROUP BY status`,
    )
    .bind(gateId)
    .all<{ status: string; n: number }>();
  const map: Record<string, number> = {};
  for (const row of counts.results) map[row.status] = row.n;
  const triggered = (map.triggered ?? 0) + (map.cta_sent ?? 0) + (map.pending_follow ?? 0) + (map.delivered ?? 0) + (map.dropped ?? 0);
  const delivered = map.delivered ?? 0;
  const follow_rate = triggered === 0 ? 0 : delivered / triggered;
  const lineLinked = await db
    .prepare(
      `SELECT COUNT(*) as n FROM gate_deliveries gd
       JOIN followers f ON f.id = gd.follower_id
       WHERE gd.gate_id = ? AND f.line_friend_uuid IS NOT NULL`,
    )
    .bind(gateId)
    .first<{ n: number }>();
  const clickCounts = await db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT COALESCE(igsid, id)) AS uniq
       FROM gate_clicks WHERE gate_id = ?`,
    )
    .bind(gateId)
    .first<{ total: number; uniq: number }>();
  return {
    triggered,
    cta_sent: map.cta_sent ?? 0,
    pending_follow: map.pending_follow ?? 0,
    delivered,
    dropped: map.dropped ?? 0,
    follow_rate,
    line_linked: lineLinked?.n ?? 0,
    clicks_total: clickCounts?.total ?? 0,
    clicks_unique: clickCounts?.uniq ?? 0,
  };
}

export async function setLineFriendUuid(
  db: D1Database,
  igsid: string,
  lineFriendUuid: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE followers SET line_friend_uuid = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')) WHERE igsid = ?`,
    )
    .bind(lineFriendUuid, igsid)
    .run();
  return result.meta.changes > 0;
}
