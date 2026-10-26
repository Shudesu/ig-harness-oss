ALTER TABLE comment_rules ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE followers ADD COLUMN messaging_owner TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE gate_deliveries ADD COLUMN end_reason TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN gate_delivery_id TEXT REFERENCES gate_deliveries(id) ON DELETE CASCADE;
ALTER TABLE comment_rule_jobs ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'legacy_dm';
ALTER TABLE comment_rule_jobs ADD COLUMN media_id TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN comment_created_at TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comment_rule_jobs ADD COLUMN error_code INTEGER;
ALTER TABLE comment_rule_jobs ADD COLUMN error_subcode INTEGER;
ALTER TABLE broadcast_recipients ADD COLUMN next_attempt_at TEXT;
ALTER TABLE broadcast_recipients ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcast_recipients ADD COLUMN error_code INTEGER;
ALTER TABLE broadcast_recipients ADD COLUMN error_subcode INTEGER;
ALTER TABLE media_posts ADD COLUMN phase TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE media_posts ADD COLUMN phase_started_at TEXT;
CREATE TABLE private_reply_attempts (
  account_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  follower_id INTEGER NOT NULL REFERENCES followers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('processing','sent','failed','uncertain')),
  attempted_at TEXT NOT NULL,
  message_id TEXT,
  error_code INTEGER,
  error_subcode INTEGER,
  PRIMARY KEY(account_id,comment_id)
);
