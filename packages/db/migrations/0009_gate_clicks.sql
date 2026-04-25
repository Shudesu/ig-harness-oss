-- Track reward-URL clicks per campaign. Populated by the /click/:gate_id
-- redirect endpoint, one row per tap. Anonymous rows (igsid NULL) are
-- allowed for users who click without the IGSID tracking parameter (e.g.
-- shared link).
CREATE TABLE IF NOT EXISTS gate_clicks (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
  igsid TEXT,
  destination_url TEXT NOT NULL,
  clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  user_agent TEXT,
  referer TEXT
);

CREATE INDEX IF NOT EXISTS idx_gate_clicks_gate ON gate_clicks(gate_id);
CREATE INDEX IF NOT EXISTS idx_gate_clicks_igsid ON gate_clicks(igsid);
