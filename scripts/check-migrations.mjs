import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { checkMigration, ADDITIVE_CUTOFF } from './migration-policy.mjs';
const directory = new URL('../packages/db/migrations/', import.meta.url);
const legacy = JSON.parse(readFileSync(new URL('./legacy-migration-checksums.json', import.meta.url), 'utf8'));
const seen = new Set();
for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
  const prefix = name.slice(0,4);
  if (seen.has(prefix)) throw new Error(`Duplicate migration number: ${prefix}`);
  seen.add(prefix);
  const sql = readFileSync(new URL(name,directory), 'utf8'); checkMigration(name,sql);
  if (Number(prefix) < ADDITIVE_CUTOFF && createHash('sha256').update(sql).digest('hex') !== legacy[name]) throw new Error(`Legacy migration changed or added: ${name}`);
}
for (const name of Object.keys(legacy)) if (!seen.has(name.slice(0,4))) throw new Error(`Legacy migration missing: ${name}`);
console.log(`Migration policy passed (${seen.size} files; additive from ${String(ADDITIVE_CUTOFF).padStart(4,'0')}).`);
