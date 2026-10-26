-- The legacy schema used an integer key but the API creates UUIDs. Rebuild it
-- without changing existing IDs or keys. Credential hashing is performed by
-- the shared migration runner (SHA-256 is not built into SQLite).
CREATE TABLE staff_members_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('owner','admin','staff')),
  api_key TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
INSERT INTO staff_members_new (id, name, email, role, api_key, is_active, created_at, updated_at)
SELECT CAST(id AS TEXT), name, email, role, api_key, is_active, created_at, COALESCE(updated_at, created_at) FROM staff_members;
DROP TABLE staff_members;
ALTER TABLE staff_members_new RENAME TO staff_members;
