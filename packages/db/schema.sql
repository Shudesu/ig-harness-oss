-- Instagram Harness D1 Schema

-- ── Followers ──
CREATE TABLE IF NOT EXISTS followers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  igsid TEXT NOT NULL UNIQUE,
  username TEXT,
  name TEXT,
  profile_pic_url TEXT,
  external_user_id TEXT,
  line_friend_uuid TEXT,
  is_following INTEGER DEFAULT 0,
  follower_count INTEGER,
  is_verified INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_followers_igsid ON followers(igsid);
CREATE INDEX IF NOT EXISTS idx_followers_username ON followers(username);
CREATE INDEX IF NOT EXISTS idx_followers_external_user_id ON followers(external_user_id);
CREATE INDEX IF NOT EXISTS idx_followers_line_friend_uuid ON followers(line_friend_uuid);

-- ── Tags ──
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6B7280',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE TABLE IF NOT EXISTS follower_tags (
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  PRIMARY KEY (follower_id, tag_id)
);

-- ── Comment Rules (IG-specific) ──
CREATE TABLE IF NOT EXISTS comment_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  media_id TEXT,
  keyword TEXT,
  match_type TEXT DEFAULT 'contains' CHECK(match_type IN ('exact', 'contains', 'regex')),
  response_type TEXT NOT NULL CHECK(response_type IN ('text', 'image', 'template', 'quick_reply')),
  response_body TEXT NOT NULL,
  delay_seconds INTEGER DEFAULT 0,
  reply_text TEXT DEFAULT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_comment_rules_media_id ON comment_rules(media_id);
CREATE INDEX IF NOT EXISTS idx_comment_rules_active ON comment_rules(is_active);

-- ── Messages Log ──
CREATE TABLE IF NOT EXISTS messages_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER REFERENCES followers(id),
  direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
  message_type TEXT NOT NULL CHECK(message_type IN ('text', 'image', 'template', 'quick_reply')),
  body TEXT NOT NULL,
  trigger_source TEXT CHECK(trigger_source IN ('comment_rule', 'scenario', 'broadcast', 'manual')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_messages_log_follower ON messages_log(follower_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_created ON messages_log(created_at);

-- ── Scenarios ──
CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('dm_keyword', 'comment', 'manual', 'follower_add')),
  trigger_keyword TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE TABLE IF NOT EXISTS scenario_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_minutes INTEGER DEFAULT 0,
  message_type TEXT NOT NULL CHECK(message_type IN ('text', 'image', 'template', 'quick_reply')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_scenario_steps_scenario ON scenario_steps(scenario_id);

CREATE TABLE IF NOT EXISTS follower_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
  next_step_at TEXT,
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_follower_scenarios_next ON follower_scenarios(status, next_step_at);

-- ── Broadcasts ──
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK(message_type IN ('text', 'image', 'template', 'quick_reply')),
  body TEXT NOT NULL,
  tag_filter TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'sending', 'sent')),
  scheduled_at TEXT,
  sent_at TEXT,
  total_sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

-- ── Forms ──
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  fields TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  answers TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

-- ── Tracked Links ──
CREATE TABLE IF NOT EXISTS tracked_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  ref_code TEXT NOT NULL UNIQUE,
  click_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE TABLE IF NOT EXISTS link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES tracked_links(id) ON DELETE CASCADE,
  follower_id INTEGER REFERENCES followers(id),
  clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

-- ── Staff ──
CREATE TABLE IF NOT EXISTS staff_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('owner', 'admin', 'staff')),
  api_key TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

-- ── Engagement Gates (ManyChat-style follow gate) ──
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
