import { afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mocks = vi.hoisted(() => ({ wrangler: vi.fn(), migrate: vi.fn(), deploy: vi.fn(), exec: vi.fn(), prepare: vi.fn(), errorLog: vi.fn() }));
vi.mock('../lib/wrangler.js', () => ({ wrangler: mocks.wrangler, setAccountId: vi.fn() }));
vi.mock('./auth.js', () => ({ ensureAuth: vi.fn() }));
vi.mock('./database.js', () => ({ migrateDatabase: mocks.migrate }));
vi.mock('./deploy-worker.js', () => ({ deployWorker: mocks.deploy }));
vi.mock('./clone-repo.js', () => ({ prepareRepository: mocks.prepare }));
vi.mock('@clack/prompts', () => ({ intro: vi.fn(), outro: vi.fn(), spinner: () => ({ start: vi.fn(), stop: vi.fn() }), log: { error: mocks.errorLog } }));
vi.mock('execa', () => ({ execa: mocks.exec }));
import { backupDatabase } from './backup.js';
import { runUpdate, resolveAdminProject } from '../commands/update.js';
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.resetAllMocks(); vi.unstubAllEnvs(); });
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'ig-backup-test-')); directories.push(dir); vi.stubEnv('IG_HARNESS_BACKUP_DIR', join(dir, 'backups')); return dir; }
it('creates a nonempty private export before migration and stops deployment on migration failure', async () => {
  const dir = fixture();
  writeFileSync(join(dir, '.ig-harness-deployed.json'), JSON.stringify({ workerName: 'test-worker', d1DatabaseName: 'test-db', d1DatabaseId: 'test-id', r2BucketName: 'test-bucket', accountId: 'test-account', workerUrl: 'https://test-worker.workers.dev', adminProjectName: 'test-admin' }));
  let backup = '';
  mocks.wrangler.mockImplementation(async (args: string[]) => { expect(args.slice(0,3)).toEqual(['d1','export','test-db']); backup = args[args.indexOf('--output') + 1]!; writeFileSync(backup, '-- synthetic test backup\n'); return ''; });
  mocks.migrate.mockImplementation(async () => { expect(existsSync(backup)).toBe(true); expect(statSync(backup).mode & 0o777).toBe(0o600); throw new Error('injected migration failure'); });
  await expect(runUpdate(dir)).rejects.toThrow('injected migration failure'); expect(mocks.migrate).toHaveBeenCalledOnce(); expect(mocks.deploy).not.toHaveBeenCalled(); expect(mocks.exec).toHaveBeenCalledOnce();
  expect(mocks.exec).toHaveBeenCalledWith('pnpm', ['run','build'], { cwd: join(dir, 'apps/web'), env: { NEXT_PUBLIC_API_URL: 'https://test-worker.workers.dev' } });
});
it('refuses to migrate when export fails or creates an empty file', async () => {
  const dir = fixture(); mocks.wrangler.mockRejectedValueOnce(new Error('export failed'));
  await expect(backupDatabase(dir, 'test-db')).rejects.toThrow('export failed');
  mocks.wrangler.mockImplementation(async (args: string[]) => { writeFileSync(args[args.indexOf('--output') + 1]!, ''); return ''; });
  await expect(backupDatabase(dir, 'test-db')).rejects.toThrow('missing or empty');
});

it('fails before any remote call when a local preflight build fails', async () => {
  const dir = fixture();
  writeFileSync(join(dir, '.ig-harness-deployed.json'), JSON.stringify({ workerName: 'test-worker', d1DatabaseName: 'test-db', d1DatabaseId: 'test-id', r2BucketName: 'test-bucket', accountId: 'test-account', workerUrl: 'https://test-worker.workers.dev', adminProjectName: 'test-admin' }));
  mocks.exec.mockRejectedValueOnce(new Error('web build failed'));
  await expect(runUpdate(dir)).rejects.toThrow('web build failed');
  expect(mocks.wrangler).not.toHaveBeenCalled(); expect(mocks.migrate).not.toHaveBeenCalled(); expect(mocks.deploy).not.toHaveBeenCalled();
});
it('reports the backup when Worker deployment fails after a successful migration', async () => {
  const dir = fixture();
  writeFileSync(join(dir, '.ig-harness-deployed.json'), JSON.stringify({ workerName: 'test-worker', d1DatabaseName: 'test-db', d1DatabaseId: 'test-id', r2BucketName: 'test-bucket', accountId: 'test-account', workerUrl: 'https://test-worker.workers.dev', adminProjectName: 'test-admin' }));
  let backup = '';
  mocks.wrangler.mockImplementation(async (args: string[]) => {
    if (args[0] === 'd1') { backup = args[args.indexOf('--output') + 1]!; writeFileSync(backup, '-- backup'); return ''; }
    if (args[1] === 'list') return '[{"name":"TOKEN_ENCRYPTION_KEY"}]';
    return '';
  });
  mocks.deploy.mockRejectedValueOnce(new Error('deploy failed'));
  await expect(runUpdate(dir)).rejects.toThrow('deploy failed');
  expect(mocks.errorLog).toHaveBeenCalledWith(`復旧用バックアップ: ${backup}`);
  expect(mocks.wrangler.mock.calls.some(([args]) => args[0] === 'pages')).toBe(false);
});
it('uses only a recorded Pages name or the recorded canonical Pages URL', () => {
  expect(resolveAdminProject('known-project', 'https://custom.example')).toBe('known-project');
  expect(resolveAdminProject(undefined, 'https://legacy-project.pages.dev')).toBe('legacy-project');
  expect(() => resolveAdminProject(undefined, 'https://unrelated.example')).toThrow('never guessed');
  expect(() => resolveAdminProject()).toThrow('never guessed');
});
