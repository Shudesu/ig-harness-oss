-- 0015_account_indexes.sql — indexes for account_id columns.
-- Split out of 0014: schema.sql runs BEFORE migrations on existing
-- databases (pnpm db:migrate chains with &&), so index statements that
-- reference account_id must live in a migration that runs after the
-- ALTERs — and separately from them, because on fresh installs the
-- ALTERs in 0014 abort (columns already exist via schema.sql) before
-- reaching any statements that follow them in the same file.
CREATE INDEX IF NOT EXISTS idx_followers_account ON followers(account_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_account ON scenarios(account_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_account ON broadcasts(account_id);
CREATE INDEX IF NOT EXISTS idx_gates_account ON engagement_gates(account_id);
CREATE INDEX IF NOT EXISTS idx_tracked_links_account ON tracked_links(account_id);
