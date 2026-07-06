import { describe, it, expect } from 'vitest';
import { recordWebhookReceived, recordCronRun, recordDmFailure, recordTokenValidity, getHealthSnapshot } from '../health.js';
import type { IgAccount } from '@ig-harness/db';

// Mock DB that tracks upserts (run() calls) so we can assert on key names.
function createMockDb(opts: {
  accounts?: Array<Partial<IgAccount> & { id: string; ig_user_id: string }>;
  settings?: Record<string, string>;
  dmSent24h?: number;
  throwOnPrepare?: boolean;
} = {}) {
  const accounts: Array<Record<string, unknown>> = (opts.accounts ?? []).map((a) => ({ ...a }));
  const settings: Record<string, string> = { ...(opts.settings ?? {}) };
  const upserts: Array<{ key: string; value: string }> = [];

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first<T>() {
        if (sql.includes('FROM messages_log') && sql.includes("direction = 'out'")) {
          return ({ n: opts.dmSent24h ?? 0 } as unknown as T);
        }
        return null;
      },
      async all<T>() {
        // listIgAccounts queries (no WHERE clause with params, or is_active = 1)
        if (sql.includes('FROM ig_accounts') && sql.includes('is_active = 1')) {
          return { results: accounts as T[] };
        }
        if (sql.includes('FROM ig_accounts')) {
          return { results: accounts as T[] };
        }
        // integration_settings health keys
        if (sql.includes('FROM integration_settings') && sql.includes("LIKE 'health:%'")) {
          const rows = Object.entries(settings)
            .filter(([k]) => k.startsWith('health:'))
            .map(([key, value]) => ({ key, value }));
          return { results: rows as T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        if (sql.includes('INTO integration_settings')) {
          upserts.push({ key: params[0] as string, value: params[1] as string ?? '1' });
          const key = params[0] as string;
          const existingVal = settings[key];
          if (sql.includes('DO UPDATE') && sql.includes('CAST')) {
            // increment counter
            settings[key] = String((parseInt(existingVal ?? '0', 10) || 0) + 1);
          } else {
            settings[key] = params[1] as string ?? '1';
          }
        }
        return { meta: { changes: 1 } };
      },
    };
  }

  const db = {
    accounts,
    settings,
    upserts,
    prepare(sql: string) {
      if (opts.throwOnPrepare) throw new Error('D1 connection error');
      const stmt = makeStatement(sql, []);
      return {
        ...stmt,
        bind(...params: unknown[]) {
          return makeStatement(sql, params);
        },
      };
    },
  } as unknown as D1Database & {
    accounts: typeof accounts;
    settings: typeof settings;
    upserts: typeof upserts;
  };

  return db;
}

describe('health helpers', () => {
  it('recordWebhookReceived upserts health:last_webhook_at:<id>', async () => {
    const db = createMockDb();
    await recordWebhookReceived(db, 'default');
    expect(db.upserts[0].key).toBe('health:last_webhook_at:default');
  });

  it('recordWebhookReceived value is an ISO8601 timestamp', async () => {
    const db = createMockDb();
    const before = new Date().toISOString();
    await recordWebhookReceived(db, 'acc1');
    const after = new Date().toISOString();
    const val = db.upserts[0].value;
    expect(val >= before && val <= after).toBe(true);
  });

  it('recordCronRun upserts health:last_cron_at', async () => {
    const db = createMockDb();
    await recordCronRun(db);
    expect(db.upserts[0].key).toBe('health:last_cron_at');
  });

  it('recordDmFailure increments todays counter key', async () => {
    const db = createMockDb();
    await recordDmFailure(db, 'acc2');
    expect(db.upserts[0].key).toMatch(/^health:dm_failures:acc2:\d{4}-\d{2}-\d{2}$/);
  });

  it('getHealthSnapshot assembles accounts with token_days_left', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({
      accounts: [{
        id: 'default',
        ig_user_id: '1',
        username: 'noda',
        access_token: 't',
        // +1h buffer keeps floor() at 10 even if the clock ticks between
        // this line and the nowSec captured inside getHealthSnapshot().
        token_expires_at: now + 10 * 86400 + 3600,
        is_active: 1,
        is_default: 1,
      }],
      settings: { 'health:last_cron_at': '2026-07-06T00:00:00Z' },
    });
    const snap = await getHealthSnapshot(db);
    expect(snap.accounts[0]!.token_days_left).toBe(10);
    expect(snap.cron_last_run_at).toBe('2026-07-06T00:00:00Z');
    expect(snap.db_ok).toBe(true);
    expect(snap.ok).toBe(true);
  });

  it('snapshot ok=false when a token is expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({
      accounts: [{
        id: 'acc1',
        ig_user_id: '2',
        username: 'expired',
        access_token: 't',
        token_expires_at: now - 86400, // expired yesterday
        is_active: 1,
        is_default: 1,
      }],
    });
    const snap = await getHealthSnapshot(db);
    expect(snap.db_ok).toBe(true);
    expect(snap.ok).toBe(false);
    expect(snap.accounts[0]!.token_days_left).toBeLessThanOrEqual(-1);
  });

  it('snapshot ok=true when a token is valid but expires within 24h (days_left floors to 0)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({
      accounts: [{
        id: 'acc1',
        ig_user_id: '2',
        username: 'almost',
        access_token: 't',
        token_expires_at: now + 12 * 3600, // valid for 12 more hours
        is_active: 1,
        is_default: 1,
      }],
    });
    const snap = await getHealthSnapshot(db);
    expect(snap.accounts[0]!.token_days_left).toBe(0);
    expect(snap.ok).toBe(true);
  });

  it('recordTokenValidity upserts health:token_valid:<id> as JSON', async () => {
    const db = createMockDb();
    await recordTokenValidity(db, 'acc1', false);
    expect(db.upserts[0].key).toBe('health:token_valid:acc1');
    const parsed = JSON.parse(db.upserts[0].value as string);
    expect(parsed.ok).toBe(false);
    expect(parsed.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('snapshot ok=false when a probed token is dead even if expiry is in the future', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({
      accounts: [{
        id: 'acc1',
        ig_user_id: '2',
        username: 'frozen',
        access_token: 't',
        token_expires_at: now + 30 * 86400, // expiry says healthy
        is_active: 1,
        is_default: 1,
      }],
      settings: {
        'health:token_valid:acc1': JSON.stringify({ ok: false, checked_at: '2026-07-07T00:00:00Z' }),
      },
    });
    const snap = await getHealthSnapshot(db);
    expect(snap.accounts[0]!.token_api_ok).toBe(false);
    expect(snap.accounts[0]!.token_api_checked_at).toBe('2026-07-07T00:00:00Z');
    expect(snap.ok).toBe(false);
  });

  it('token_api_ok is null when the account was never probed', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({
      accounts: [{
        id: 'acc1', ig_user_id: '2', username: 'x', access_token: 't',
        token_expires_at: now + 30 * 86400, is_active: 1, is_default: 1,
      }],
    });
    const snap = await getHealthSnapshot(db);
    expect(snap.accounts[0]!.token_api_ok).toBeNull();
    expect(snap.ok).toBe(true);
  });

  it('snapshot ok=false when no active accounts exist (unseeded deployment)', async () => {
    const db = createMockDb({ accounts: [] });
    const snap = await getHealthSnapshot(db);
    expect(snap.db_ok).toBe(true);
    expect(snap.accounts).toHaveLength(0);
    expect(snap.ok).toBe(false);
  });

  it('getHealthSnapshot returns db_ok=false when DB throws', async () => {
    const db = createMockDb({ throwOnPrepare: true });
    const snap = await getHealthSnapshot(db);
    expect(snap.db_ok).toBe(false);
    expect(snap.ok).toBe(false);
    expect(snap.accounts).toHaveLength(0);
  });

  it('getHealthSnapshot includes dm_sent_24h count', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = createMockDb({
      accounts: [{
        id: 'acc1',
        ig_user_id: '1',
        username: 'noda',
        access_token: 't',
        token_expires_at: now + 5 * 86400,
        is_active: 1,
        is_default: 1,
      }],
      dmSent24h: 42,
    });
    const snap = await getHealthSnapshot(db);
    expect(snap.dm_sent_24h).toBe(42);
  });

  it('token_days_left is null when token_expires_at is null', async () => {
    const db = createMockDb({
      accounts: [{
        id: 'acc1',
        ig_user_id: '1',
        username: 'noda',
        access_token: 't',
        token_expires_at: null,
        is_active: 1,
        is_default: 1,
      }],
    });
    const snap = await getHealthSnapshot(db);
    expect(snap.accounts[0]!.token_days_left).toBeNull();
    // ok should be true when token_expires_at is null (unknown expiry, not expired)
    expect(snap.ok).toBe(true);
  });
});
