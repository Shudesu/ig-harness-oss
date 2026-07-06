import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../index.js';

// Mock getHealthSnapshot before importing the route so the import resolves to the mock.
vi.mock('../../lib/health.js', () => ({
  getHealthSnapshot: vi.fn(),
  recordWebhookReceived: vi.fn(),
  recordCronRun: vi.fn(),
  recordDmFailure: vi.fn(),
}));

import { getHealthSnapshot } from '../../lib/health.js';
import type { HealthSnapshot } from '../../lib/health.js';

// Import the health router after mocking its dependency.
import { health } from '../health.js';

// Build a minimal Env bindings object for app.request().
function mockEnv(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    IG_APP_SECRET: 'test-secret',
    IG_ACCESS_TOKEN: 'test-token',
    IG_USER_ID: '123',
    IG_VERIFY_TOKEN: 'test-verify',
    API_KEY: 'test-key',
    WORKER_URL: 'https://test.workers.dev',
    ...overrides,
  };
}

const baseSnapshot: HealthSnapshot = {
  ok: true,
  checked_at: '2026-07-06T00:00:00.000Z',
  accounts: [
    {
      account_id: 'acc-1',
      username: 'noda',
      token_expires_at: 9999999999,
      token_days_left: 30,
      token_api_ok: null,
      token_api_checked_at: null,
      last_webhook_event_at: null,
      dm_failures_today: 0,
    },
  ],
  dm_sent_24h: 5,
  cron_last_run_at: '2026-07-06T00:00:00.000Z',
  db_ok: true,
};

describe('GET /api/health', () => {
  it('returns 200 with snapshot json when db_ok=true', async () => {
    vi.mocked(getHealthSnapshot).mockResolvedValueOnce(baseSnapshot);

    const res = await health.request('/api/health', {}, mockEnv());

    expect(res.status).toBe(200);
    const body = await res.json<{ success: boolean; data: HealthSnapshot }>();
    expect(body.success).toBe(true);
    expect(body.data.accounts).toHaveLength(1);
    expect(body.data).toHaveProperty('cron_last_run_at');
    expect(body.data.db_ok).toBe(true);
  });

  it('returns 200 (not 500) when db_ok=false — monitoring must always get a response', async () => {
    const degradedSnapshot: HealthSnapshot = {
      ok: false,
      checked_at: '2026-07-06T00:00:00.000Z',
      accounts: [],
      dm_sent_24h: 0,
      cron_last_run_at: null,
      db_ok: false,
    };
    vi.mocked(getHealthSnapshot).mockResolvedValueOnce(degradedSnapshot);

    const res = await health.request('/api/health', {}, mockEnv());

    expect(res.status).toBe(200);
    const body = await res.json<{ success: boolean; data: HealthSnapshot }>();
    expect(body.success).toBe(true);
    expect(body.data.db_ok).toBe(false);
    expect(body.data.ok).toBe(false);
  });

  it('passes the DB binding from env to getHealthSnapshot', async () => {
    vi.mocked(getHealthSnapshot).mockResolvedValueOnce(baseSnapshot);
    const fakeDb = { _name: 'fake-db' } as unknown as D1Database;

    await health.request('/api/health', {}, mockEnv({ DB: fakeDb }));

    expect(vi.mocked(getHealthSnapshot)).toHaveBeenCalledWith(fakeDb);
  });
});
