import { splitSql } from './sql-statements.mjs';
export const ADDITIVE_CUTOFF = 20;
export function checkMigration(name, sql) {
  if (!/^\d{4}_[\w-]+\.sql$/.test(name)) throw new Error(`Invalid migration filename: ${name}`);
  if (Number(name.slice(0,4)) < ADDITIVE_CUTOFF) return;
  for (const [index, statement] of splitSql(sql).entries()) {
    if (/^(?:DROP|TRUNCATE|DELETE|REPLACE)\b/i.test(statement) || (/^ALTER\s+TABLE\b/i.test(statement) && !/^ALTER\s+TABLE\s+(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[\w.]+)\s+ADD\b/i.test(statement)) || /^CREATE\s+(?:(?:TEMP|TEMPORARY)\s+)?TRIGGER\b/i.test(statement)) {
      throw new Error(`${name} statement ${index + 1}: destructive or compound migration rejected; use an additive change`);
    }
  }
}
