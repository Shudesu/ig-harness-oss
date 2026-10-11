import { describe, it, expect, vi } from 'vitest';
import { TenantScheduler } from '../tenant-scheduler.js';
import { runScheduledJobs } from '../index.js';
vi.mock('../index.js', () => ({ runScheduledJobs: vi.fn() }));

function fixture(alarm: number | null = null) {
  const storage = { getAlarm: vi.fn(async () => alarm), setAlarm: vi.fn(async (_value: number) => {}) };
  const scheduler = new TenantScheduler({ storage } as unknown as DurableObjectState, {} as never);
  return { storage, scheduler };
}

describe('tenant scheduler', () => {
  it('arming repeatedly preserves the pending tick; GET cannot start jobs', async () => {
    const { scheduler, storage } = fixture(123);
    expect((await scheduler.fetch(new Request('https://scheduler/arm', { method: 'POST' }))).status).toBe(200);
    expect(storage.setAlarm).not.toHaveBeenCalled();
    expect((await scheduler.fetch(new Request('https://scheduler/arm'))).status).toBe(404);
  });
  it('creates the first alarm and runs a tick with a future alarm already stored', async () => {
    const { scheduler, storage } = fixture();
    await scheduler.fetch(new Request('https://scheduler/arm', { method: 'POST' }));
    expect(storage.setAlarm).toHaveBeenCalledOnce();
    vi.mocked(runScheduledJobs).mockImplementationOnce(async () => {
      expect(storage.setAlarm).toHaveBeenCalledTimes(2);
    });
    await scheduler.alarm();
  });
  it('job failure does not cancel future ticks or trigger batch replay', async () => {
    const { scheduler, storage } = fixture();
    vi.mocked(runScheduledJobs).mockRejectedValueOnce(new Error('network'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(scheduler.alarm()).resolves.toBeUndefined();
    expect(storage.setAlarm).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
