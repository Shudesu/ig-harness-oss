-- Multi-post gate targeting. A single engagement_gate used to be bound to
-- exactly one post (engagement_gates.target_post_id TEXT). Operators now
-- need to attach the same campaign to many reels without duplicating the
-- whole gate + rich_message trio, so we introduce a junction table and
-- copy the existing single-target values into it.

CREATE TABLE IF NOT EXISTS gate_target_posts (
  gate_id TEXT NOT NULL REFERENCES engagement_gates(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  PRIMARY KEY (gate_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_gate_target_posts_post ON gate_target_posts(post_id);

-- Back-fill: each existing gate with a non-NULL target_post_id gets one
-- junction row. Gates with NULL target stay as "applies to all posts".
INSERT OR IGNORE INTO gate_target_posts (gate_id, post_id)
SELECT id, target_post_id
FROM engagement_gates
WHERE target_post_id IS NOT NULL AND target_post_id != '';

-- engagement_gates.target_post_id stays in the schema for backward
-- compatibility with any external tool that reads it, but the junction
-- table is the source of truth going forward.
