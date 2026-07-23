-- Media posts: feed images / carousels / reels / stories published via
-- the Content Publishing API. Unified state machine — immediate posts are
-- rows with scheduled_at = now.
CREATE TABLE media_posts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ig_accounts(id),
  post_type TEXT NOT NULL CHECK (post_type IN ('feed_image','carousel','reel','story')),
  media TEXT NOT NULL,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','processing','published','failed','canceled')),
  scheduled_at TEXT NOT NULL,
  creation_id TEXT,
  child_creation_ids TEXT,
  published_media_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_media_posts_account_status ON media_posts(account_id, status);
CREATE INDEX idx_media_posts_status_scheduled ON media_posts(status, scheduled_at);
