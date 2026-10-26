-- Browser credentials are random session IDs, never the reusable API key.
CREATE TABLE admin_sessions (
  id_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX idx_admin_sessions_staff ON admin_sessions(staff_id, created_at);
