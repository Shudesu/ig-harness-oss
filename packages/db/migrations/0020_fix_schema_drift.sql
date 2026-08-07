-- 0020: comprehensive schema-drift fix.
-- schema.sql ships OLD definitions for many tables while the worker code
-- (packages/db/src/*.ts) expects newer schemas — every affected create endpoint
-- (comment rules, forms, tracked links, staff, form submissions, link clicks) 500s
-- with "no such column" or an id datatype mismatch (schema id INTEGER vs code UUID TEXT).
-- All affected tables verified EMPTY (0 rows) before rebuild; rebuilds fix the id-type
-- mismatch that ALTER cannot. Derived from the TypeScript interfaces + INSERT statements.

-- === ALTER: follower_tags is a composite key (no id) — just add the missing column ===
ALTER TABLE follower_tags ADD COLUMN assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')));

-- === REBUILD: comment_rules & forms ALSO bind a UUID id (crypto.randomUUID) into an
--     INTEGER id column -> datatype mismatch on every create. Rebuild with id TEXT. ===
DROP TABLE IF EXISTS comment_rules;
CREATE TABLE comment_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, media_id TEXT, keyword TEXT, match_type TEXT,
  response_type TEXT NOT NULL, response_body TEXT NOT NULL, delay_seconds INTEGER DEFAULT 0,
  reply_text TEXT, is_active INTEGER NOT NULL DEFAULT 1, trigger_type TEXT NOT NULL DEFAULT 'comment',
  account_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);
DROP TABLE IF EXISTS forms;
CREATE TABLE forms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, fields TEXT NOT NULL DEFAULT '[]',
  on_submit_tag_id TEXT, on_submit_scenario_id TEXT, on_submit_message_type TEXT, on_submit_message_content TEXT,
  save_to_metadata INTEGER DEFAULT 1, submit_count INTEGER DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  account_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

-- === REBUILD: schema id=INTEGER but code uses UUID(TEXT); tables empty ===
DROP TABLE IF EXISTS form_submissions;
CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  friend_id TEXT,
  data TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

DROP TABLE IF EXISTS link_clicks;
CREATE TABLE link_clicks (
  id TEXT PRIMARY KEY,
  tracked_link_id TEXT NOT NULL DEFAULT '',
  friend_id TEXT,
  clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

DROP TABLE IF EXISTS staff_members;
CREATE TABLE staff_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,
  api_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

-- tracked_links: keep legacy destination_url/ref_code (webhook.ts CONNECT-token lookup)
-- alongside the new CRUD columns (original_url, tag_id, scenario_id, is_active, updated_at).
DROP TABLE IF EXISTS tracked_links;
CREATE TABLE tracked_links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  original_url TEXT NOT NULL DEFAULT '',
  destination_url TEXT,
  ref_code TEXT,
  tag_id TEXT,
  scenario_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  click_count INTEGER NOT NULL DEFAULT 0,
  account_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

-- === CREATE: tables the code uses (health/migrations) that schema.sql never defined ===
CREATE TABLE IF NOT EXISTS account_health_logs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  error_code INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  check_period TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);
CREATE TABLE IF NOT EXISTS account_migrations (
  id TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  migrated_count INTEGER DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_link_clicks_link ON link_clicks(tracked_link_id);
CREATE INDEX IF NOT EXISTS idx_tracked_links_account ON tracked_links(account_id);
CREATE INDEX IF NOT EXISTS idx_tracked_links_refcode ON tracked_links(ref_code);
CREATE INDEX IF NOT EXISTS idx_staff_apikey ON staff_members(api_key);
CREATE INDEX IF NOT EXISTS idx_comment_rules_account2 ON comment_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_forms_account ON forms(account_id);
