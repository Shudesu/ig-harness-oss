import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMigration } from './migration-policy.mjs';
import { splitSql } from './sql-statements.mjs';
test('rejects new destructive migrations even behind comments', () => {
  for (const sql of ['DROP TABLE followers;', '/* explanatory; comment */ DROP TABLE followers;', 'ALTER TABLE followers RENAME TO lost;', 'DELETE FROM followers;', 'CREATE TRIGGER x AFTER INSERT ON followers BEGIN DELETE FROM followers; END;']) assert.throws(() => checkMigration('0021_unsafe.sql', sql), /rejected/);
});
test('accepts additive DDL and does not mistake quoted strings for SQL', () => {
  checkMigration('0021_safe.sql', "CREATE TABLE example(id TEXT); ALTER TABLE example ADD COLUMN note TEXT DEFAULT 'DROP TABLE; -- not SQL';");
  assert.deepEqual(splitSql("/* ; */ SELECT 'a;''b'; -- ;\n SELECT \"quoted;name\";"), ["SELECT 'a;''b'", 'SELECT "quoted;name"']);
});

test('retries transient reads with a bounded backoff and rejects permanent errors immediately', async () => {
  const { retryD1Read } = await import('./d1-read-retry.mjs');
  let calls=0; const delays=[];
  assert.equal(await retryD1Read(async () => { if (++calls < 3) throw new Error('ECONNRESET'); return 'ok'; }, async ms => { delays.push(ms); }), 'ok');
  assert.deepEqual(delays,[200,400]);
  calls=0;
  await assert.rejects(retryD1Read(async () => { calls++; throw new Error('permission denied'); }, async () => {}), /permission denied/);
  assert.equal(calls,1);
});
