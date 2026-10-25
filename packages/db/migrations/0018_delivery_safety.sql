-- Durable recipient/event state. Existing history is retained.
ALTER TABLE follower_scenarios ADD COLUMN end_reason TEXT;
ALTER TABLE followers ADD COLUMN profile_fetched_at TEXT;
ALTER TABLE followers ADD COLUMN last_inbound_at TEXT;
UPDATE followers SET last_inbound_at = (
  SELECT MAX(created_at) FROM messages_log WHERE follower_id = followers.id AND direction = 'in'
);
CREATE INDEX idx_followers_inbound ON followers(account_id, last_inbound_at);
CREATE INDEX idx_messages_log_inbound ON messages_log(follower_id, direction, created_at);

CREATE TABLE broadcast_runs (
  broadcast_id INTEGER PRIMARY KEY REFERENCES broadcasts(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL
);
CREATE TABLE broadcast_recipients (
  broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','sent','failed','skipped','uncertain')),
  reason TEXT,
  attempted_at TEXT,
  sent_at TEXT,
  PRIMARY KEY (broadcast_id, follower_id)
);
CREATE INDEX idx_broadcast_recipients_pending ON broadcast_recipients(broadcast_id, status, follower_id);

-- Event payload is retained only until successful processing, then removed.
-- An interrupted processing claim is never automatically replayed: external
-- effects may already have happened. See operations/review-remediation.md.
CREATE TABLE webhook_events (
  account_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','uncertain')),
  received_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  PRIMARY KEY (account_id, event_key)
);
CREATE INDEX idx_webhook_events_pending ON webhook_events(account_id, status, received_at);

CREATE TABLE comment_rule_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_text TEXT,
  due_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','skipped','uncertain')),
  reason TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_comment_rule_jobs_due ON comment_rule_jobs(account_id, status, due_at);

CREATE TABLE data_deletion_requests (
  code TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL UNIQUE,
  subject_hash TEXT NOT NULL,
  app_fingerprint TEXT NOT NULL,
  meta_user_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending_identity','completed')),
  requested_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_data_deletion_subject ON data_deletion_requests(subject_hash, requested_at);

CREATE TABLE data_deletion_locks (
  account_id TEXT PRIMARY KEY,
  request_code TEXT NOT NULL
);

CREATE TABLE active_mutations (id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
