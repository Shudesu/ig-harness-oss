-- Fix: migration 0014 adds `account_id` to 9 tables in one file, but schema.sql
-- (consolidated snapshot) already contains account_id on 8 of them and OMITS it on
-- comment_rules. Because `wrangler d1 execute --file` is atomic, 0014's first ALTER
-- (followers, duplicate column) aborts the whole file — so comment_rules never gets
-- account_id. Result: `[accounts] backfill failed for comment_rules: no such column:
-- account_id` on every /api/accounts and /api/friends call.
--
-- This standalone migration adds just the missing column + index. SQLite has no
-- ADD COLUMN IF NOT EXISTS, so on a DB where it already exists this errors harmlessly
-- (the error-tolerant migration runner skips it). Safe to keep for fresh deploys.
ALTER TABLE comment_rules ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_comment_rules_account ON comment_rules(account_id);
