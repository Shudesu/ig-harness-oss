-- 0026_mention_events.sql — B-14: record mentions (comments/captions) that
-- arrive via the `mentions` webhook field. The event value carries only
-- {media_id, comment_id}; the fetched content (text/username) is stored
-- here for audit and rule replies. Additive-only.
CREATE TABLE IF NOT EXISTS mention_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'media')),
  comment_id TEXT,
  media_id TEXT,
  username TEXT,
  text TEXT,
  replied INTEGER NOT NULL DEFAULT 0,
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_mention_events_account ON mention_events(account_id, created_at);
