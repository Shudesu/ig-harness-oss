-- 0025_ig_account_connection_type.sql (0024 is reserved by the parallel improve-all branch) — Unified login (Facebook Login) support
-- New Meta apps (2026-10〜) only offer "Instagram API with Unified login":
-- EAA… Facebook / system-user tokens against graph.facebook.com. Existing rows
-- keep the historical behaviour through the 'instagram_login' default.
-- page_id is the linked Facebook Page when known (NULL otherwise).
ALTER TABLE ig_accounts ADD COLUMN connection_type TEXT NOT NULL DEFAULT 'instagram_login' CHECK (connection_type IN ('instagram_login','facebook_login'));
ALTER TABLE ig_accounts ADD COLUMN page_id TEXT;
