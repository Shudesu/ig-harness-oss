import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { fileURLToPath } from 'node:url';

let schemaPromise: Promise<string> | undefined;
async function migratedSchema(): Promise<string> {
  const seed = new DatabaseSync(':memory:');
  const runnerUrl = new URL('../../../../scripts/migration-runner.mjs', import.meta.url).href;
  const { applyMigrations } = await import(runnerUrl);
  try {
    await applyMigrations({
      repoDir: fileURLToPath(new URL('../../../../', import.meta.url).href), log() {},
      query: async (sql: string) => seed.prepare(sql).all(),
      execute: async (sql: string) => { seed.exec('BEGIN'); try { seed.exec(sql); seed.exec('COMMIT'); } catch (e) { seed.exec('ROLLBACK'); throw e; } },
    });
    return seed.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all().map(row => String(row.sql) + ';').join('\n');
  } finally { seed.close(); }
}

export async function testDatabase() {
  // Read/apply migrations once per test process. Each test still gets an
  // isolated SQLite DB with the exact migrated schema, avoiding slow external
  // filesystem reads inside every concurrency/authorization assertion.
  const schema = await (schemaPromise ??= migratedSchema());
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(schema);
  const adapt = (sql: string, args: any[] = []): any => ({
    sql, args, bind: (...values: any[]) => adapt(sql, values),
    first: async (column?: string) => { const row = sqlite.prepare(sql).get(...args); return column ? row?.[column] ?? null : row ?? null; },
    all: async () => ({ success: true, results: sqlite.prepare(sql).all(...args), meta: {} }),
    run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  });
  const db = { prepare: adapt, batch: async (statements: any[]) => {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map((s) => {
        const prepared = sqlite.prepare(s.sql);
        if (/\bRETURNING\b/i.test(s.sql)) return { success: true, results: prepared.all(...s.args), meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get()?.n ?? 0) } };
        return { success: true, results: [], meta: { changes: Number(prepared.run(...s.args).changes) } };
      });
      sqlite.exec('COMMIT'); return results;
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } } as unknown as D1Database;
  return { sqlite, db };
}
