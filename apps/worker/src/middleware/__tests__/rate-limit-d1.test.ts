import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import { checkShared, resetRateLimitsForTests } from '../rate-limit.js';
import { isPublicRequest } from '../auth.js';
const open: Array<{ close(): void }> = [];
const random = () => crypto.randomUUID();
afterEach(() => { for (const db of open.splice(0)) db.close(); vi.useRealTimers(); resetRateLimitsForTests(); });
it('shares D1 limits across isolate resets, resets expired buckets, and supports unmigrated DBs', async () => {
  const f = await testDatabase(); open.push(f.sqlite); const key = random(); vi.useFakeTimers();
  expect((await checkShared(f.db, key, 2, 60000)).ok).toBe(true);
  resetRateLimitsForTests(); expect((await checkShared(f.db, key, 2, 60000)).ok).toBe(true);
  expect((await checkShared(f.db, key, 2, 60000)).ok).toBe(false);
  expect(f.sqlite.prepare('SELECT bucket_key FROM rate_limit_buckets').get()!.bucket_key).not.toBe(key);
  vi.advanceTimersByTime(60000); expect((await checkShared(f.db, key, 2, 60000)).ok).toBe(true);
  const missing = { prepare() { throw new Error('no table'); } } as unknown as D1Database;
  expect((await checkShared(missing, key, 1, 60000)).ok).toBe(true); expect((await checkShared(missing, key, 1, 60000)).ok).toBe(false);
  expect(isPublicRequest('/api/webhooks/incoming/missing/receive', 'POST')).toBe(false);
});
