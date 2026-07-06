-- Migration 0016: Extend messages_log.trigger_source CHECK to include 'gate'
-- SQLite cannot ALTER a CHECK constraint, so we rebuild the table.

CREATE TABLE messages_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER REFERENCES followers(id),
  direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
  message_type TEXT NOT NULL CHECK(message_type IN ('text', 'image', 'template', 'quick_reply')),
  body TEXT NOT NULL,
  trigger_source TEXT CHECK(trigger_source IN ('comment_rule', 'scenario', 'broadcast', 'manual', 'gate')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

INSERT INTO messages_log_new SELECT * FROM messages_log;

DROP TABLE messages_log;

ALTER TABLE messages_log_new RENAME TO messages_log;

CREATE INDEX idx_messages_log_follower ON messages_log(follower_id);
CREATE INDEX idx_messages_log_created ON messages_log(created_at);
