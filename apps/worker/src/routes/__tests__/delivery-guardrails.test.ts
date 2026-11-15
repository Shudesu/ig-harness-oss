import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { deliveryStatus } from '../delivery-status.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';

const app = (f: Awaited<ReturnType<typeof gateFixture>>) => {
  const hono = new Hono<any>();
  hono.route('/', deliveryStatus);
  return { hono, env: { DB: f.db, IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test' } };
};

it('returns the guardrail snapshot for the selected account', async () => {
  const f = await gateFixture();
  try {
    const { hono, env } = app(f);
    const response = await hono.request('https://worker.example/api/delivery-guardrails?account_id=a', {}, env);
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.data).toMatchObject({
      paused: false,
      presenceEnabled: false,
      window: { startHourJst: 9, endHourJst: 23 },
      followers: { eligible: expect.any(Number), windowExpired: expect.any(Number), standby: expect.any(Number) },
      volume: { dmOut24h: expect.any(Number), pendingBroadcastRecipients: expect.any(Number), pendingCommentJobs: expect.any(Number), activeScenarios: expect.any(Number) },
    });
    expect(JSON.stringify(result)).not.toContain('test'); // access token value
    expect((await hono.request('https://worker.example/api/delivery-guardrails?account_id=missing', {}, env)).status).toBe(404);
  } finally {
    f.sqlite.close();
  }
});

it('toggles the stop switch and the presence setting', async () => {
  const f = await gateFixture();
  try {
    const { hono, env } = app(f);
    const pause = await hono.request('https://worker.example/api/delivery-guardrails/pause?account_id=a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true }) }, env);
    expect(pause.status).toBe(200);
    const afterPause = await (await hono.request('https://worker.example/api/delivery-guardrails?account_id=a', {}, env)).json() as any;
    expect(afterPause.data.paused).toBe(true);

    const presence = await hono.request('https://worker.example/api/delivery-guardrails/presence?account_id=a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) }, env);
    expect(presence.status).toBe(200);
    const afterPresence = await (await hono.request('https://worker.example/api/delivery-guardrails?account_id=a', {}, env)).json() as any;
    expect(afterPresence.data.presenceEnabled).toBe(true);

    // validation
    expect((await hono.request('https://worker.example/api/delivery-guardrails/pause?account_id=a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: 'yes' }) }, env)).status).toBe(400);
    expect((await hono.request('https://worker.example/api/delivery-guardrails/presence?account_id=a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env)).status).toBe(400);
  } finally {
    f.sqlite.close();
  }
});
