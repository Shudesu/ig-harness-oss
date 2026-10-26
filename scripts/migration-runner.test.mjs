import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, splitSql } from './migration-runner.mjs';
const repoDir = fileURLToPath(new URL('../', import.meta.url));
function adapter(db, fail) {
  return { repoDir, log() {}, query: async (sql) => db.prepare(sql).all(), execute: async (sql) => {
    db.exec('BEGIN');
    try { for (const statement of splitSql(sql)) { if (fail?.(statement)) throw new Error('injected failure'); db.exec(statement); } db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
}
test('fresh install, second run, staff hashing and account ownership preservation', async () => {
  const db = new DatabaseSync(':memory:');
  await applyMigrations(adapter(db));
  for (const table of ['gate_clicks','integration_settings','line_harness_connections','media_posts','broadcast_recipients','webhook_events']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table));
  db.exec("INSERT INTO staff_members(id,name,api_key) VALUES ('uuid-staff','Staff','igh_TEST_ONLY'); INSERT INTO comment_rules(name,response_type,response_body,account_id) VALUES ('test','text','{}','account-a')");
  await applyMigrations(adapter(db));
  assert.match(db.prepare('SELECT api_key FROM staff_members').get().api_key, /^sha256:[a-f0-9]{64}$/);
  assert.equal(db.prepare('SELECT account_id FROM comment_rules').get().account_id, 'account-a');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ig_schema_migrations').get().n, 21);
  db.close();
});
test('a failed file has no success marker and can resume without losing earlier migrations', async () => {
  const db = new DatabaseSync(':memory:');
  await assert.rejects(applyMigrations(adapter(db, (sql) => sql.includes('CREATE TABLE broadcast_runs'))), /0018_delivery_safety/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ig_schema_migrations WHERE name LIKE '0018%'").get().n, 0);
  await applyMigrations(adapter(db));
  assert.ok(db.prepare("SELECT name FROM ig_schema_migrations WHERE name LIKE '0018%'").get());
  db.close();
});
test('applied-file drift stops rather than silently skipping a changed migration', async () => {
  const db = new DatabaseSync(':memory:');
  await applyMigrations(adapter(db));
  db.exec("UPDATE ig_schema_migrations SET sha256='wrong' WHERE name='0001_engagement_gates.sql'");
  await assert.rejects(applyMigrations(adapter(db)), /Applied migration changed/);
  db.close();
});
test('adopts an untracked partially upgraded DB without dropping staff metadata or account scope', async () => {
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  const schema = readFileSync(new URL('../packages/db/schema.sql', import.meta.url), 'utf8')
    .replace('  line_friend_uuid TEXT,\n', '').replace('CREATE INDEX IF NOT EXISTS idx_followers_line_friend_uuid ON followers(line_friend_uuid);', '');
  db.exec(schema);
  db.exec("ALTER TABLE staff_members ADD COLUMN email TEXT; ALTER TABLE staff_members ADD COLUMN updated_at TEXT; INSERT INTO staff_members(id,name,role,api_key,email,updated_at) VALUES(1,'Test','owner','test-only','owner@example.invalid','2026-01-01'); INSERT INTO comment_rules(name,response_type,response_body,account_id) VALUES('Keep','text','{}','account-a')");
  await applyMigrations(adapter(db));
  assert.equal(db.prepare('SELECT account_id FROM comment_rules').get().account_id, 'account-a');
  assert.deepEqual({ ...db.prepare('SELECT id,email,updated_at FROM staff_members').get() }, { id: '1', email: 'owner@example.invalid', updated_at: '2026-01-01' });
  await applyMigrations(adapter(db));
  db.close();
});
test('does not trust a completion ledger when the real schema has drifted', async () => {
  const db = new DatabaseSync(':memory:'); await applyMigrations(adapter(db));
  db.exec('ALTER TABLE followers DROP COLUMN profile_fetched_at');
  await assert.rejects(applyMigrations(adapter(db)), /Schema verification failed: followers.profile_fetched_at/);
  db.close();
});
