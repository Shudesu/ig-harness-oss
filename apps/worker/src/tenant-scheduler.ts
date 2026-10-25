import type { Env } from './index.js';
import { runScheduledJobs } from './index.js';

const INTERVAL_MS = 5 * 60 * 1000;

/** A tenant-local clock for Workers for Platforms, where cron triggers are unavailable. */
export class TenantScheduler {
  constructor(private state: DurableObjectState, private env: Env['Bindings']) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/arm') {
      return new Response('Not found', { status: 404 });
    }
    if (await this.state.storage.getAlarm() === null) {
      await this.state.storage.setAlarm(Date.now() + INTERVAL_MS);
    }
    return Response.json({ armed: true });
  }

  async alarm(): Promise<void> {
    // Set the next tick before doing network work. A job error must not stop the clock,
    // nor replay an entire batch of potentially delivered messages via alarm retries.
    await this.state.storage.setAlarm(Date.now() + INTERVAL_MS);
    const background: Promise<unknown>[] = [];
    try {
      await runScheduledJobs(this.env, { waitUntil: (task: Promise<unknown>) => background.push(task) });
    } catch (error) {
      console.error('[scheduler] tick failed', error instanceof Error ? error.name : 'unknown');
    } finally {
      await Promise.allSettled(background);
    }
  }
}

export { armScheduler } from './lib/scheduler-client.js';
