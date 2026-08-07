-- Fix: on a fresh setup, schema.sql already defines engagement_gates.line_connection_id,
-- so migration 0011's trailing `ALTER TABLE engagement_gates ADD COLUMN line_connection_id`
-- fails with "duplicate column name". Because `wrangler d1 execute --file` runs a file
-- atomically, that failure rolls back the CREATE TABLE in the same file — leaving
-- line_harness_connections missing and breaking the LINE Harness cross-link.
--
-- This migration re-creates just the table + index (idempotent, no ALTERs) so it applies
-- cleanly whether or not 0011 succeeded. Safe to re-run.
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
