import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('execa', () => ({ execa: mocks.exec }));
import { ensureRepo } from './clone-repo.js';
const directories: string[] = [];
beforeEach(() => { mocks.exec.mockResolvedValue({ stdout: '' }); });
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function repository(name = 'ig-harness') {
  const path = mkdtempSync(join(tmpdir(), 'ig-prepare-test-')); directories.push(path);
  writeFileSync(join(path, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name }));
  return path;
}
it('installs and builds libraries for an explicitly selected fresh repository without pulling it', async () => {
  const path = repository(); expect(await ensureRepo(path)).toBe(path);
  expect(mocks.exec).toHaveBeenCalledWith('npx', ['pnpm','install','--frozen-lockfile'], { cwd: path });
  expect(mocks.exec).toHaveBeenCalledWith('npx', ['pnpm','--filter','./packages/*','build'], { cwd: path });
  expect(mocks.exec.mock.calls.some(([command]) => command === 'git')).toBe(false);
});
it('prepares the current repository too', async () => {
  const path = repository(); vi.spyOn(process, 'cwd').mockReturnValue(path);
  await ensureRepo(null); expect(mocks.exec).toHaveBeenCalledTimes(2);
});
it('rejects an unrelated workspace instead of installing or cloning into another location', async () => {
  await expect(ensureRepo(repository('another-project'))).rejects.toThrow('IG Harness');
  expect(mocks.exec).not.toHaveBeenCalled();
});
it('stops after a failed frozen install rather than building with stale dependencies', async () => {
  const path = repository(); mocks.exec.mockRejectedValueOnce(new Error('install failed'));
  await expect(ensureRepo(path)).rejects.toThrow('install failed'); expect(mocks.exec).toHaveBeenCalledTimes(1);
});
