-- Multi-connection LINE Harness config, mirroring the X Harness pattern.
-- One row per LINE Harness deployment (本番 / テスト / ...); campaigns
-- reference a connection by id + optionally a pool slug, and LINE-side
-- concerns (pool, forms, tagging) stay on the LINE Harness side.

CREATE TABLE IF NOT EXISTS line_harness_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  worker_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  account_id TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);

CREATE INDEX IF NOT EXISTS idx_line_harness_connections_default
  ON line_harness_connections(is_default);

-- Per-gate LINE context. Nullable — empty means "no LINE delegation".
ALTER TABLE engagement_gates ADD COLUMN line_connection_id TEXT;
ALTER TABLE engagement_gates ADD COLUMN line_pool_slug TEXT;
