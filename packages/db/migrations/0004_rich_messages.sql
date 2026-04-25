-- Rich messages: reusable structured DM templates for engagement gates
-- (image + text + buttons blocks, sent as a chain of IG Messenger API calls)

CREATE TABLE IF NOT EXISTS rich_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('cta','reward','reminder','generic')),
  blocks TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_rich_messages_kind ON rich_messages(kind);

ALTER TABLE engagement_gates ADD COLUMN initial_dm_rich_message_id TEXT;
ALTER TABLE engagement_gates ADD COLUMN reward_dm_rich_message_id TEXT;
ALTER TABLE engagement_gates ADD COLUMN follow_reminder_dm_rich_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_gates_initial_rm ON engagement_gates(initial_dm_rich_message_id);
CREATE INDEX IF NOT EXISTS idx_gates_reward_rm ON engagement_gates(reward_dm_rich_message_id);
CREATE INDEX IF NOT EXISTS idx_gates_reminder_rm ON engagement_gates(follow_reminder_dm_rich_message_id);
