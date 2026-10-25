import type { Env } from '../index.js';

export async function armScheduler(env: Env['Bindings']): Promise<void> {
  if (!env.TENANT_SCHEDULER) return;
  const stub = env.TENANT_SCHEDULER.get(env.TENANT_SCHEDULER.idFromName('tenant'));
  const response = await stub.fetch('https://scheduler/arm', { method: 'POST' });
  if (!response.ok) throw new Error('Scheduler arm failed');
}
