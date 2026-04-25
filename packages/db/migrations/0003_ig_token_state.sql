-- Long-lived IG access token state (single row). Cron refreshes it before expiry
-- so the Worker can keep calling the Graph API past the 60-day env token window.
CREATE TABLE IF NOT EXISTS ig_token_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL
);
