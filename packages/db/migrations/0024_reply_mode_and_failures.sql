-- Public comment replies: thread reply (POST /{comment-id}/replies) is the
-- default; 'mention' keeps the legacy @username top-level comment.
ALTER TABLE engagement_gates ADD COLUMN comment_reply_mode TEXT NOT NULL DEFAULT 'thread';
ALTER TABLE comment_rules ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'thread';
ALTER TABLE comment_rule_jobs ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'thread';
ALTER TABLE comment_rule_jobs ADD COLUMN error_message TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN public_reply_status TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN public_reply_id TEXT;
ALTER TABLE comment_rule_jobs ADD COLUMN public_reply_error_code INTEGER;
ALTER TABLE comment_rule_jobs ADD COLUMN public_reply_error_message TEXT;
-- Operator-visible failure log (Meta error code/message, sanitized).
CREATE TABLE IF NOT EXISTS delivery_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  source TEXT NOT NULL,
  stage TEXT,
  ref_id TEXT,
  follower_id INTEGER,
  error_code INTEGER,
  error_subcode INTEGER,
  http_status INTEGER,
  message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_failures_account ON delivery_failures(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_failures_follower ON delivery_failures(follower_id);
