-- Engagement Gates (ManyChat-style follow gate)

CREATE TABLE IF NOT EXISTS engagement_gates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('comment_on_post','dm_keyword','story_mention')),
  target_post_id TEXT,
  trigger_keyword TEXT,
  require_follow INTEGER NOT NULL DEFAULT 1,
  initial_dm_text TEXT NOT NULL,
  initial_dm_button_label TEXT NOT NULL DEFAULT '特典を受け取る',
  follow_reminder_dm_text TEXT NOT NULL,
  follow_reminder_button_label TEXT NOT NULL DEFAULT 'フォローしたよ',
  reward_dm_text TEXT NOT NULL,
  reward_url TEXT,
  max_loops INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_engagement_gates_status ON engagement_gates(status);
CREATE INDEX IF NOT EXISTS idx_engagement_gates_target_post ON engagement_gates(target_post_id);

CREATE TABLE IF NOT EXISTS gate_deliveries (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  igsid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'triggered'
    CHECK(status IN ('triggered','cta_sent','pending_follow','delivered','dropped')),
  loop_count INTEGER NOT NULL DEFAULT 0,
  last_check_at TEXT,
  triggered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  delivered_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_gate_deliveries_gate ON gate_deliveries(gate_id);
CREATE INDEX IF NOT EXISTS idx_gate_deliveries_follower ON gate_deliveries(follower_id);
CREATE INDEX IF NOT EXISTS idx_gate_deliveries_igsid ON gate_deliveries(igsid);
CREATE INDEX IF NOT EXISTS idx_gate_deliveries_status ON gate_deliveries(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_deliveries_gate_follower ON gate_deliveries(gate_id, follower_id);

ALTER TABLE followers ADD COLUMN line_friend_uuid TEXT;
CREATE INDEX IF NOT EXISTS idx_followers_line_friend_uuid ON followers(line_friend_uuid);
