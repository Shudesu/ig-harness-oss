-- 0027_comment_rule_jobs_is_live.sql — B-15: mark jobs enqueued from
-- live_comments so the processor can skip them once the live has ended.
-- Additive-only.
ALTER TABLE comment_rule_jobs ADD COLUMN is_live INTEGER NOT NULL DEFAULT 0;
