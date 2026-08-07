-- Fix: schema.sql ships an OLD scenarios/scenario_steps schema that the code
-- (packages/db/src/scenarios.ts) does not match — causing every scenario/step
-- create to 500 with "no such column". Specifically the code expects:
--   scenarios:      id TEXT (UUID), description, trigger_tag_id, line_account_id
--   scenario_steps: id TEXT (UUID), condition_type, condition_value, next_step_on_false
-- but schema.sql has id INTEGER AUTOINCREMENT, trigger_keyword only, no description, etc.
-- SQLite cannot ALTER a column type, and both tables are create-time empty, so we
-- rebuild them to match the code. Safe on fresh deploys (tables just created, empty).
DROP TABLE IF EXISTS scenario_steps;
DROP TABLE IF EXISTS scenarios;
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_keyword TEXT,
  trigger_tag_id TEXT,
  line_account_id TEXT,
  account_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);
CREATE TABLE scenario_steps (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  message_type TEXT NOT NULL,
  body TEXT NOT NULL,
  condition_type TEXT,
  condition_value TEXT,
  next_step_on_false INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
);
CREATE INDEX IF NOT EXISTS idx_scenarios_account ON scenarios(account_id);
CREATE INDEX IF NOT EXISTS idx_scenario_steps_scenario ON scenario_steps(scenario_id);
