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
  created_at: string;
  updated_at: string;
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
        reward_dm_text, reward_url, max_loops)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, gate.name, gate.status, gate.trigger_type, gate.target_post_id,
      gate.trigger_keyword, gate.require_follow, gate.initial_dm_text,
      gate.initial_dm_button_label, gate.follow_reminder_dm_text,
      gate.follow_reminder_button_label, gate.reward_dm_text,
      gate.reward_url, gate.max_loops,
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
  return result.results;
}

export async function getEngagementGate(
  db: D1Database,
  id: string,
): Promise<EngagementGate | null> {
  return await db
    .prepare('SELECT * FROM engagement_gates WHERE id = ?')
    .bind(id)
    .first<EngagementGate>();
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
  data: { gate_id: string; follower_id: number; igsid: string; metadata?: object },
): Promise<GateDelivery> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO gate_deliveries (id, gate_id, follower_id, igsid, metadata)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(gate_id, follower_id) DO NOTHING`,
    )
    .bind(id, data.gate_id, data.follower_id, data.igsid, JSON.stringify(data.metadata ?? {}))
    .run();
  const row = await db
    .prepare('SELECT * FROM gate_deliveries WHERE gate_id = ? AND follower_id = ?')
    .bind(data.gate_id, data.follower_id)
    .first<GateDelivery>();
  if (!row) throw new Error('Failed to create or fetch gate delivery');
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
  patch: { status?: GateDelivery['status']; loop_count?: number; delivered_at?: string | null; last_check_at?: string | null },
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
  return {
    triggered,
    cta_sent: map.cta_sent ?? 0,
    pending_follow: map.pending_follow ?? 0,
    delivered,
    dropped: map.dropped ?? 0,
    follow_rate,
    line_linked: lineLinked?.n ?? 0,
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
