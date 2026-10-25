import { mkdirSync, statSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { wrangler } from '../lib/wrangler.js';

export async function backupDatabase(repoDir: string, databaseName: string): Promise<string> {
  const directory = resolve(process.env.IG_HARNESS_BACKUP_DIR || join(repoDir, '.backups'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `ig-d1-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
  await wrangler(['d1', 'export', databaseName, '--remote', '--output', file], { cwd: repoDir });
  if (!statSync(file).isFile() || statSync(file).size === 0) throw new Error('D1 backup is missing or empty; update aborted');
  chmodSync(file, 0o600);
  return file;
}
