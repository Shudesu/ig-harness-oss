import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ wrangler: vi.fn() }));
vi.mock('../lib/wrangler.js', () => mocks);
import { configureAdminAuth } from './admin-auth.js';
beforeEach(() => { mocks.wrangler.mockReset(); });
function settings(initial: string[] = [], persist = true) {
  const names = new Set(initial);
  mocks.wrangler.mockImplementation(async (args: string[]) => {
    if (args[1] === 'list') return JSON.stringify([...names].map(name => ({ name })));
    if (persist) names.add(args[2]!);
    return '';
  });
}
it('configures and verifies cross-site Pages auth before deployment', async () => {
  settings(); await configureAdminAuth('worker','https://admin.pages.dev','https://api.workers.dev');
  expect(mocks.wrangler).toHaveBeenCalledWith(['secret','put','ADMIN_ORIGIN','--name','worker'], { input: 'https://admin.pages.dev' });
  expect(mocks.wrangler).toHaveBeenCalledWith(['secret','put','ADMIN_ALLOW_CROSS_SITE','--name','worker'], { input: 'true' });
});
it('preserves existing custom origins and explicit cross-site choices', async () => {
  settings(['ADMIN_ORIGINS','ADMIN_ALLOW_CROSS_SITE']); await configureAdminAuth('worker','https://admin.example.com','https://api.example.com');
  expect(mocks.wrangler.mock.calls.every(([args]) => args[1] === 'list')).toBe(true);
});
it('stops when required settings are not persisted', async () => {
  settings([], false); await expect(configureAdminAuth('worker','https://admin.pages.dev','https://api.workers.dev')).rejects.toThrow('incomplete');
});
