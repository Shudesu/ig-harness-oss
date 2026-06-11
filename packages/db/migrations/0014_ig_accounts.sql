-- 0014_ig_accounts.sql — multi-account support
-- One row per Instagram business account managed by this deployment.
-- app_secret / verify_token are NULL when the account lives under the same
-- Meta App as the env-configured one (env IG_APP_SECRET / IG_VERIFY_TOKEN
-- apply); set them only for accounts connected through a different Meta App.
CREATE TABLE IF NOT EXISTS ig_accounts (
  id TEXT PRIMARY KEY,
  ig_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  access_token TEXT NOT NULL,
  token_expires_at INTEGER,
  token_refreshed_at INTEGER,
  app_secret TEXT,
  verify_token TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE followers ADD COLUMN account_id TEXT;
ALTER TABLE tags ADD COLUMN account_id TEXT;
ALTER TABLE comment_rules ADD COLUMN account_id TEXT;
ALTER TABLE scenarios ADD COLUMN account_id TEXT;
ALTER TABLE broadcasts ADD COLUMN account_id TEXT;
ALTER TABLE engagement_gates ADD COLUMN account_id TEXT;
ALTER TABLE forms ADD COLUMN account_id TEXT;
ALTER TABLE tracked_links ADD COLUMN account_id TEXT;
ALTER TABLE rich_messages ADD COLUMN account_id TEXT;
