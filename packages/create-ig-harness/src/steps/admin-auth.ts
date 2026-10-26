import { wrangler } from '../lib/wrangler.js';
import { isCrossSite } from '../../../../apps/worker/src/middleware/admin-auth-config.js';

export async function configureAdminAuth(workerName: string, adminUrl: string, workerUrl: string): Promise<void> {
  const admin = new URL(adminUrl), worker = new URL(workerUrl);
  if (admin.protocol !== 'https:' || worker.protocol !== 'https:' || admin.username || admin.password || worker.username || worker.password) throw new Error('Admin and Worker URLs must be HTTPS origins without credentials');
  const listNames = async () => {
    const values = JSON.parse(await wrangler(['secret','list','--name',workerName]));
    if (!Array.isArray(values)) throw new Error('Could not inspect admin authentication settings');
    return new Set(values.map((value: { name: string }) => value.name));
  };
  const names = await listNames();
  // Existing secret allowlists can include operator-managed custom domains. Preserve
  // them, including the IG plural alias, instead of replacing with one URL.
  if (!names.has('ADMIN_ORIGIN') && !names.has('ADMIN_ORIGINS')) await wrangler(['secret','put','ADMIN_ORIGIN','--name',workerName], { input: admin.origin });
  if (!names.has('ADMIN_ALLOW_CROSS_SITE')) await wrangler(['secret','put','ADMIN_ALLOW_CROSS_SITE','--name',workerName], { input: String(isCrossSite(admin.origin, worker.origin)) });
  const verified = await listNames();
  if ((!verified.has('ADMIN_ORIGIN') && !verified.has('ADMIN_ORIGINS')) || !verified.has('ADMIN_ALLOW_CROSS_SITE')) throw new Error('Admin authentication configuration is incomplete; deployment stopped');
}
