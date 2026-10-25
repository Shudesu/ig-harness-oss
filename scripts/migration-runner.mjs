import { createHash } from 'node:crypto';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const digest = (value) => createHash('sha256').update(value).digest('hex');

// SQL in this repository has no triggers. Respect quoted strings and comments,
// and reject unterminated input rather than splitting a string at a semicolon.
export function splitSql(sql) {
  const out = [];
  let statement = '', quoted = false, comment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (comment) { if (ch === '\n') { comment = false; statement += '\n'; } continue; }
    if (!quoted && ch === '-' && next === '-') { comment = true; i++; continue; }
    if (ch === "'") {
      statement += ch;
      if (quoted && next === "'") { statement += next; i++; continue; }
      quoted = !quoted; continue;
    }
    if (!quoted && ch === ';') { if (statement.trim()) out.push(statement.trim()); statement = ''; }
    else statement += ch;
  }
  if (quoted) throw new Error('Unterminated SQL string');
  if (statement.trim()) out.push(statement.trim());
  return out;
}

async function tableSql(query, name) {
  return (await query(`SELECT sql FROM sqlite_master WHERE type='table' AND name=${quote(name)}`))[0]?.sql ?? '';
}

// The pre-ledger releases mixed a current schema.sql with historical ALTERs.
// Reconcile ONLY those known releases, using schema evidence (never error text).
export async function planLegacyMigration(name, sql, query) {
  if (name === '0005_any_comment_match_type.sql' && (await tableSql(query, 'comment_rules')).includes("'any_comment'")) return [];
  if (name === '0016_messages_log_gate_source.sql' && (await tableSql(query, 'messages_log')).includes("'gate'")) return [];
  const planned = [];
  for (let statement of splitSql(sql)) {
    const add = statement.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+) (\w+)/i);
    if (add) {
      const columns = await query(`PRAGMA table_info(${add[1]})`);
      const existing = columns.find((c) => c.name === add[2]);
      if (existing) {
        if (existing.type.toUpperCase() !== add[3].toUpperCase()) throw new Error(`Schema drift: ${add[1]}.${add[2]} has unexpected type`);
        continue;
      }
    }
    // The final legacy migration used unguarded CREATEs. Check the actual table
    // before adopting it into the ledger; a partially-created table is an error.
    if (name === '0017_media_posts.sql') {
      if (/^CREATE TABLE media_posts\b/i.test(statement)) {
        const columns = await query('PRAGMA table_info(media_posts)');
        if (columns.length) {
          const required = [...statement.matchAll(/^\s+(\w+)\s+(?:TEXT|INTEGER)\b/gm)].map((m) => m[1]);
          if (required.some((column) => !columns.some((c) => c.name === column))) throw new Error('Schema drift: incomplete media_posts');
          continue;
        }
      }
      statement = statement.replace(/^CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ');
    }
    planned.push(statement);
  }
  // Preserve account ownership even on an unusual partially-upgraded database.
  if (name === '0005_any_comment_match_type.sql') {
    const cols = await query('PRAGMA table_info(comment_rules)');
    if (!cols.some((c) => c.name === 'reply_text')) planned.unshift('ALTER TABLE comment_rules ADD COLUMN reply_text TEXT');
    if (cols.some((c) => c.name === 'account_id')) {
      return planned.map((s) => s.replace('reply_text TEXT DEFAULT NULL,', 'reply_text TEXT DEFAULT NULL,\n  account_id TEXT,').replace('delay_seconds, reply_text, is_active', 'delay_seconds, reply_text, account_id, is_active'));
    }
  }
  return planned;
}

export async function applyMigrations({ repoDir, query, execute, log = console.log }) {
  await execute(`CREATE TABLE IF NOT EXISTS ig_schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));`);
  // Bootstrap once, only on an empty application DB. Never run the evolving
  // schema over an existing installation (its indexes may reference new columns).
  if (!(await tableSql(query, 'followers'))) {
    const tables = await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('ig_schema_migrations','d1_migrations')");
    if (tables.length) throw new Error('Partial application schema: restore/repair before bootstrap');
    try { await execute(await readFile(join(repoDir, 'packages/db/schema.sql'), 'utf8')); }
    catch (error) { throw new Error('schema.sql failed', { cause: error }); }
  }
  const dir = join(repoDir, 'packages/db/migrations');
  const files = (await readdir(dir)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  const applied = new Map((await query('SELECT name, sha256 FROM ig_schema_migrations')).map((row) => [row.name, row.sha256]));
  for (const name of files) {
    const sql = await readFile(join(dir, name), 'utf8');
    const hash = digest(sql);
    if (applied.has(name)) {
      if (applied.get(name) !== hash) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    try {
      const statements = Number(name.slice(0, 4)) <= 17 ? await planLegacyMigration(name, sql, query) : splitSql(sql);
      if (name === '0019_staff_schema.sql') {
        const columns = await query('PRAGMA table_info(staff_members)');
        for (const column of ['email', 'updated_at']) {
          if (!columns.some((c) => c.name === column)) statements.unshift(`ALTER TABLE staff_members ADD COLUMN ${column} TEXT`);
        }
      }
      await execute([...statements, `INSERT INTO ig_schema_migrations (name, sha256) VALUES (${quote(name)}, ${quote(hash)})`].join(';\n') + ';');
      log(`Applied ${name}`);
    } catch (error) { throw new Error(`Migration failed: ${name}`, { cause: error }); }
  }
  // Hash old staff credentials without printing them. The adapter's temporary SQL
  // file is private (0600) and removed on every exit. Compare-and-swap preserves
  // simultaneous rotations, including those made by an older worker version.
  const staff = await query("SELECT id, api_key FROM staff_members WHERE api_key NOT LIKE 'sha256:%'");
  for (const row of staff) {
    await execute(`UPDATE staff_members SET api_key=${quote(`sha256:${digest(row.api_key)}`)} WHERE id=${quote(row.id)} AND api_key=${quote(row.api_key)};`);
  }
}

export async function runMigrations({ repoDir, runWrangler, remote, databaseName = 'DB', databaseId, log }) {
  const temp = await mkdtemp(join(tmpdir(), 'ig-migrate-'));
  try {
    let config = join(repoDir, 'apps/worker/wrangler.toml');
    if (databaseId) {
      config = join(temp, 'wrangler.json');
      await writeFile(config, JSON.stringify({ name: 'ig-migrations', compatibility_date: '2026-01-01', d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: databaseId }] }));
    }
    const args = ['d1', 'execute', databaseName, remote ? '--remote' : '--local', '--config', config, '--json'];
    if (!remote) args.push('--persist-to', join(repoDir, 'apps/worker/.wrangler/state'));
    const invoke = async (sql, read = false) => {
      const file = join(temp, 'migration.sql');
      await writeFile(file, sql, { mode: 0o600 });
      const raw = await runWrangler([...args, ...(read ? ['--command', sql] : ['--file', file])], { cwd: repoDir });
      const results = JSON.parse(raw);
      const list = Array.isArray(results) ? results : [results];
      if (list.some((r) => r.success === false)) throw new Error('D1 returned an unsuccessful result');
      return list.flatMap((r) => r.results ?? []);
    };
    await applyMigrations({ repoDir, query: (sql) => invoke(sql, true), execute: invoke, log });
  } finally { await rm(temp, { recursive: true, force: true }); }
}
