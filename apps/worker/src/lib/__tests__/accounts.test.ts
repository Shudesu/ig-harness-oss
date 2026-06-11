import { describe, it, expect } from 'vitest';
import { ensureDefaultAccount, pickAccountForEntry, toIgAccountRef } from '../accounts.js';
import type { IgAccount } from '@ig-harness/db';

/**
 * Shape-accurate mock covering the SQL the accounts layer touches:
 * ig_accounts (SELECT/INSERT), ig_token_state (legacy singleton read), and
 * the backfill UPDATEs against legacy tables. Mirrors the createMockDb style
 * used by line-cross-link.test.ts.
 */
function createMockDb(opts: {
  accounts?: Array<Partial<IgAccount> & { id: string; ig_user_id: string }>;
  tokenState?: { access_token: string; expires_at: number; refreshed_at: number } | null;
  tokenStateTableMissing?: boolean;
  settings?: Record<string, string>;
} = {}) {
  const accounts: Array<Record<string, unknown>> = (opts.accounts ?? []).map((a) => ({ ...a }));
  const backfilled: Array<{ table: string; accountId: string }> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const settings: Record<string, string> = { ...(opts.settings ?? {}) };

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first<T>() {
        if (sql.includes('FROM ig_accounts') && sql.includes('LIMIT 1') && !sql.includes('WHERE')) {
          return (accounts[0] as T) ?? null;
        }
        if (sql.includes('FROM ig_accounts') && sql.includes('is_default = 1')) {
          return (accounts.find((a) => a.is_default === 1) as T) ?? null;
        }
        if (sql.includes('FROM ig_accounts') && sql.includes('ig_user_id = ?')) {
          return (accounts.find((a) => a.ig_user_id === params[0]) as T) ?? null;
        }
        if (sql.includes('FROM ig_accounts') && sql.includes('WHERE id = ?')) {
          return (accounts.find((a) => a.id === params[0]) as T) ?? null;
        }
        if (sql.includes('FROM ig_token_state')) {
          if (opts.tokenStateTableMissing) throw new Error('no such table: ig_token_state');
          return (opts.tokenState as T) ?? null;
        }
        if (sql.includes('FROM integration_settings')) {
          return (settings[params[0] as string] !== undefined
            ? ({ value: settings[params[0] as string] } as T)
            : null);
        }
        return null;
      },
      async all<T>() {
        if (sql.includes('FROM ig_accounts')) {
          return { results: accounts as T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        if (sql.startsWith('INSERT INTO ig_accounts')) {
          const [id, igUserId, username, accessToken, expiresAt, refreshedAt] = params;
          if (accounts.some((a) => a.ig_user_id === igUserId)) {
            throw new Error('UNIQUE constraint failed: ig_accounts.ig_user_id');
          }
          const isDefault = params[8];
          const row = {
            id, ig_user_id: igUserId, username, access_token: accessToken,
            token_expires_at: expiresAt, token_refreshed_at: refreshedAt,
            app_secret: null, verify_token: null,
            is_active: 1, is_default: isDefault,
            created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
          };
          accounts.push(row);
          inserted.push(row);
          return { meta: { changes: 1 } };
        }
        const backfillMatch = sql.match(/^UPDATE (\w+) SET account_id = \? WHERE account_id IS NULL$/);
        if (backfillMatch) {
          backfilled.push({ table: backfillMatch[1]!, accountId: params[0] as string });
          return { meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO integration_settings')) {
          settings[params[0] as string] = '1';
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
  }

  return {
    accounts,
    backfilled,
    inserted,
    settings,
    prepare(sql: string) {
      const stmt = makeStatement(sql, []);
      return { ...stmt, bind(...params: unknown[]) { return makeStatement(sql, params); } };
    },
  } as unknown as D1Database & {
    accounts: typeof accounts;
    backfilled: typeof backfilled;
    inserted: typeof inserted;
    settings: typeof settings;
  };
}

function makeAccount(overrides: Partial<IgAccount> = {}): IgAccount {
  return {
    id: 'acc-1',
    ig_user_id: '17841400000000001',
    username: 'main_account',
    access_token: 'tok',
    token_expires_at: null,
    token_refreshed_at: null,
    app_secret: null,
    verify_token: null,
    is_active: 1,
    is_default: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const ENV = {
  IG_USER_ID: '17841400000000001',
  IG_USERNAME: 'main_account',
  IG_ACCESS_TOKEN: 'env-token',
};

describe('ensureDefaultAccount', () => {
  it('seeds the default account from env and backfills every legacy table', async () => {
    const db = createMockDb({ tokenStateTableMissing: true });
    await ensureDefaultAccount(ENV, db);

    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({
      ig_user_id: '17841400000000001',
      username: 'main_account',
      access_token: 'env-token',
      is_default: 1,
    });
    const tables = db.backfilled.map((b) => b.table).sort();
    expect(tables).toEqual([
      'broadcasts', 'comment_rules', 'engagement_gates', 'followers',
      'forms', 'rich_messages', 'scenarios', 'tags', 'tracked_links',
    ]);
    expect(new Set(db.backfilled.map((b) => b.accountId)).size).toBe(1);
  });

  it('is idempotent — does nothing when seeded and the backfill flag is set', async () => {
    const db = createMockDb({
      accounts: [makeAccount()],
      settings: { account_backfill_done: '1' },
    });
    await ensureDefaultAccount(ENV, db);
    expect(db.inserted).toHaveLength(0);
    expect(db.backfilled).toHaveLength(0);
  });

  it('retries the legacy backfill when seeded but the flag is missing', async () => {
    // Simulates a first run that created the account row but hit a transient
    // D1 error mid-backfill: later requests must finish stamping NULL rows.
    const db = createMockDb({ accounts: [makeAccount()] });
    await ensureDefaultAccount(ENV, db);
    expect(db.inserted).toHaveLength(0);
    expect(db.backfilled).toHaveLength(9);
    expect(db.settings.account_backfill_done).toBe('1');
  });

  it('marks the backfill flag after a successful seed', async () => {
    const db = createMockDb({ tokenStateTableMissing: true });
    await ensureDefaultAccount(ENV, db);
    expect(db.settings.account_backfill_done).toBe('1');
  });

  it('prefers a still-valid token from the legacy ig_token_state singleton', async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const db = createMockDb({
      tokenState: { access_token: 'refreshed-token', expires_at: future, refreshed_at: future - 100 },
    });
    await ensureDefaultAccount(ENV, db);
    expect(db.inserted[0]).toMatchObject({
      access_token: 'refreshed-token',
      token_expires_at: future,
    });
  });

  it('ignores an expired ig_token_state token and falls back to env', async () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const db = createMockDb({
      tokenState: { access_token: 'stale-token', expires_at: past, refreshed_at: past - 100 },
    });
    await ensureDefaultAccount(ENV, db);
    expect(db.inserted[0]).toMatchObject({ access_token: 'env-token' });
  });

  it('recovers when a concurrent request won the INSERT race', async () => {
    // Mock: first SELECT sees empty, but the INSERT hits UNIQUE because the
    // "winner" row appears in between. Simulate by pre-registering the row
    // under the same ig_user_id while keeping the initial existence check
    // empty — easiest with a custom prepare wrapper.
    const db = createMockDb({});
    const realPrepare = db.prepare.bind(db);
    let firstExistenceCheck = true;
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (sql.includes('FROM ig_accounts') && sql.includes('LIMIT 1') && !sql.includes('WHERE') && firstExistenceCheck) {
        firstExistenceCheck = false;
        // Winner inserts while we're deciding.
        (db.accounts as Array<Record<string, unknown>>).push({
          ...makeAccount({ id: 'winner-id' }),
        });
        return { bind: () => ({ first: async () => null }), first: async () => null };
      }
      return realPrepare(sql);
    };
    await ensureDefaultAccount(ENV, db);
    // No second row created; backfill used the winner's id.
    expect(db.accounts).toHaveLength(1);
    expect(db.backfilled.every((b) => b.accountId === 'winner-id')).toBe(true);
  });
});

describe('pickAccountForEntry', () => {
  it('matches entry.id to the account ig_user_id', () => {
    const a = makeAccount({ id: 'a', ig_user_id: '111' });
    const b = makeAccount({ id: 'b', ig_user_id: '222', is_default: 0 });
    expect(pickAccountForEntry([a, b], '222')?.id).toBe('b');
  });

  it('falls back to the only active account when entry.id is unknown', () => {
    const a = makeAccount({ id: 'a', ig_user_id: '111' });
    expect(pickAccountForEntry([a], 'unknown')?.id).toBe('a');
  });

  it('returns null for unknown entry.id with multiple active accounts', () => {
    const a = makeAccount({ id: 'a', ig_user_id: '111' });
    const b = makeAccount({ id: 'b', ig_user_id: '222', is_default: 0 });
    expect(pickAccountForEntry([a, b], 'unknown')).toBeNull();
  });

  it('returns null when the matched account is inactive', () => {
    const a = makeAccount({ id: 'a', ig_user_id: '111', is_active: 0 });
    const b = makeAccount({ id: 'b', ig_user_id: '222', is_default: 0 });
    expect(pickAccountForEntry([a, b], '111')).toBeNull();
  });

  it('skips inactive accounts in the single-active fallback', () => {
    const a = makeAccount({ id: 'a', ig_user_id: '111', is_active: 0 });
    const b = makeAccount({ id: 'b', ig_user_id: '222', is_default: 0 });
    expect(pickAccountForEntry([a, b], 'unknown')?.id).toBe('b');
  });
});

describe('toIgAccountRef', () => {
  it('maps ig_user_id/username and drops null username', () => {
    expect(toIgAccountRef(makeAccount())).toEqual({ id: '17841400000000001', username: 'main_account' });
    expect(toIgAccountRef(makeAccount({ username: null }))).toEqual({ id: '17841400000000001', username: undefined });
  });
});
