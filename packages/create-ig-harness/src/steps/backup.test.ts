import { afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mocks = vi.hoisted(() => ({ wrangler: vi.fn(), migrate: vi.fn(), deploy: vi.fn(), exec: vi.fn() }));
vi.mock('../lib/wrangler.js', () => ({ wrangler: mocks.wrangler, setAccountId: vi.fn() }));
vi.mock('./auth.js', () => ({ ensureAuth: vi.fn() }));
vi.mock('./database.js', () => ({ migrateDatabase: mocks.migrate }));
vi.mock('./deploy-worker.js', () => ({ deployWorker: mocks.deploy }));
vi.mock('execa', () => ({ execa: mocks.exec }));
import { backupDatabase } from './backup.js';
import { runUpdate } from '../commands/update.js';
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.resetAllMocks(); vi.unstubAllEnvs(); });
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'ig-backup-test-')); directories.push(dir); vi.stubEnv('IG_HARNESS_BACKUP_DIR', join(dir, 'backups')); return dir; }
it('creates a nonempty private export before migration and stops deployment on migration failure', async () => {
  const dir = fixture();
  writeFileSync(join(dir, '.ig-harness-deployed.json'), JSON.stringify({ workerName: 'test-worker', d1DatabaseName: 'test-db', d1DatabaseId: 'test-id', r2BucketName: 'test-bucket', accountId: 'test-account' }));
  let backup = '';
  mocks.wrangler.mockImplementation(async (args: string[]) => { expect(args.slice(0,3)).toEqual(['d1','export','test-db']); backup = args[args.indexOf('--output') + 1]!; writeFileSync(backup, '-- synthetic test backup\n'); return ''; });
  mocks.migrate.mockImplementation(async () => { expect(existsSync(backup)).toBe(true); expect(statSync(backup).mode & 0o777).toBe(0o600); throw new Error('injected migration failure'); });
  await expect(runUpdate(dir)).rejects.toThrow('injected migration failure'); expect(mocks.migrate).toHaveBeenCalledOnce(); expect(mocks.deploy).not.toHaveBeenCalled(); expect(mocks.exec).not.toHaveBeenCalled();
});
it('refuses to migrate when export fails or creates an empty file', async () => {
  const dir = fixture(); mocks.wrangler.mockRejectedValueOnce(new Error('export failed'));
  await expect(backupDatabase(dir, 'test-db')).rejects.toThrow('export failed');
  mocks.wrangler.mockImplementation(async (args: string[]) => { writeFileSync(args[args.indexOf('--output') + 1]!, ''); return ''; });
  await expect(backupDatabase(dir, 'test-db')).rejects.toThrow('missing or empty');
});
