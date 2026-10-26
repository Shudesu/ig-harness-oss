-- Keep canonical integer IDs, destinations, ref codes and click history.
-- Add the action fields used by the tracked-link API without rebuilding tables.
ALTER TABLE tracked_links ADD COLUMN tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL;
ALTER TABLE tracked_links ADD COLUMN scenario_id INTEGER REFERENCES scenarios(id) ON DELETE SET NULL;
ALTER TABLE tracked_links ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tracked_links ADD COLUMN updated_at TEXT;
UPDATE tracked_links SET updated_at=created_at WHERE updated_at IS NULL;
