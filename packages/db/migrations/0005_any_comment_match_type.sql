-- Allow `any_comment` as a comment_rules.match_type so rules can fire on
-- every comment to a post (or every comment on the account when media_id
-- is NULL) without a keyword. SQLite can't alter a CHECK constraint in
-- place, so rebuild the column via a temp-table round-trip.

-- D1 disallows `ALTER TABLE ... RENAME TO ...` when FKs reference the
-- table, but comment_rules has no incoming references, so the standard
-- recipe is safe here.

CREATE TABLE comment_rules_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  media_id TEXT,
  keyword TEXT,
  match_type TEXT DEFAULT 'contains' CHECK(match_type IN ('exact', 'contains', 'regex', 'any_comment')),
  response_type TEXT NOT NULL CHECK(response_type IN ('text', 'image', 'template', 'quick_reply')),
  response_body TEXT NOT NULL,
  delay_seconds INTEGER DEFAULT 0,
  reply_text TEXT DEFAULT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

INSERT INTO comment_rules_new
SELECT id, name, media_id, keyword, match_type, response_type, response_body,
       delay_seconds, reply_text, is_active, created_at, updated_at
FROM comment_rules;

DROP TABLE comment_rules;
ALTER TABLE comment_rules_new RENAME TO comment_rules;

-- schema.sql declares these indexes; the table drop above removed them, so
-- recreate them to match fresh-install behavior.
CREATE INDEX IF NOT EXISTS idx_comment_rules_media_id ON comment_rules(media_id);
CREATE INDEX IF NOT EXISTS idx_comment_rules_active ON comment_rules(is_active);
