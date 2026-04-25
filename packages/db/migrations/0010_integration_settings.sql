-- Generic key-value store for external-integration config (LINE Harness,
-- future: Threads, TikTok, etc). Lets the operator configure connections
-- through the admin UI without wrangler secret put.
--
-- Keys used today:
--   line_harness_url         — e.g. https://line-crm-worker.line-crm-api.workers.dev
--   line_harness_api_key     — Bearer token for LINE Harness API
--   line_harness_account_id  — optional, for multi-account LINE Harness tenants
CREATE TABLE IF NOT EXISTS integration_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);
