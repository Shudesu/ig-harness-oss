/**
 * Tests: account-scope authorization on single-friend endpoints (FIX-A)
 *
 * Verifies that:
 * (a) GET /api/friends/:id with a cross-account friend → 404
 * (b) GET /api/friends/:id with an in-scope friend → 200
 * (c) GET /api/friends/:id/messages cross-account → 404
 * (d) GET /api/friends/:id/messages in-scope → 200
 * (e) POST /api/friends/:id/messages cross-account → 404
 * (f) POST /api/friends/:id/messages in-scope → 200
 * (g) POST /api/friends/:id/tags cross-account → 404
 * (h) POST /api/friends/:id/tags in-scope → 201
 * (i) DELETE /api/friends/:id/tags/:tagId cross-account → 404
 * (j) DELETE /api/friends/:id/tags/:tagId in-scope → 200
 * (k) PUT /api/friends/:id/metadata cross-account → 404
 * (l) PUT /api/friends/:id/metadata in-scope → 200
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic imports
// ---------------------------------------------------------------------------

const dbMocks = vi.hoisted(() => ({
  getFriendById: vi.fn(),
  getFriendTags: vi.fn(),
  addTagToFriend: vi.fn(),
  removeTagFromFriend: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getIgAccountById: vi.fn(),
  jstNow: vi.fn().mockReturnValue('2026-01-01T00:00:00Z'),
}));

vi.mock('@ig-harness/db', () => dbMocks);

const accountsMocks = vi.hoisted(() => ({
  resolveAccount: vi.fn(),
  getAccountClient: vi.fn(),
}));

vi.mock('../../lib/accounts.js', () => accountsMocks);

import { friends } from '../friends.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_A = { id: 'account-A', ig_user_id: 'ig-A', username: 'acct_a', access_token: 'tok', is_active: 1, is_default: 1 };
const ACCOUNT_B = { id: 'account-B', ig_user_id: 'ig-B', username: 'acct_b', access_token: 'tok2', is_active: 1, is_default: 0 };

const FRIEND_IN_SCOPE = {
  id: '1',
  igsid: 'igsid-1',
  name: 'Alice',
  username: 'alice',
  profile_pic_url: null,
  score: 0,
  metadata: '{}',
  first_seen_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  account_id: 'account-A',
};

const FRIEND_CROSS_ACCOUNT = {
  ...FRIEND_IN_SCOPE,
  id: '2',
  account_id: 'account-B',
};

function makeDb(ownerRow: { account_id: string | null } | null = null) {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => ownerRow,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: {} }),
      }),
      first: async () => ownerRow,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: {} }),
    }),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database) {
  return {
    DB: db,
    IG_APP_SECRET: 'secret',
    IG_ACCESS_TOKEN: 'tok',
    IG_USER_ID: 'ig-A',
    IG_VERIFY_TOKEN: 'vt',
    API_KEY: 'key',
    WORKER_URL: 'https://test.workers.dev',
  };
}

const executionCtx = {
  waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
  passThroughOnException: () => {},
} as ExecutionContext;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/friends/:id account-scope (FIX-A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getFriendTags.mockResolvedValue([]);
  });

  it('(a) cross-account friend → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getFriendById.mockResolvedValue(FRIEND_CROSS_ACCOUNT);

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/2'),
      makeEnv(makeDb()),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  it('(b) in-scope friend → 200', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getFriendById.mockResolvedValue(FRIEND_IN_SCOPE);

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/1'),
      makeEnv(makeDb()),
      executionCtx,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe('GET /api/friends/:id/messages account-scope (FIX-A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(c) cross-account friend → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    // Ownership DB row returns cross-account
    const db = makeDb({ account_id: 'account-B' });
    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/2/messages'),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  it('(d) in-scope friend → 200', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    const db = makeDb({ account_id: 'account-A' });
    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/1/messages'),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/friends/:id/messages account-scope (FIX-A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(e) cross-account friend → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getFriendById.mockResolvedValue(FRIEND_CROSS_ACCOUNT);

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/2/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"text":"hi"}' }),
      }),
      makeEnv(makeDb()),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  it('(f) in-scope friend → delegates to IG client', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getFriendById.mockResolvedValue(FRIEND_IN_SCOPE);
    dbMocks.getIgAccountById.mockResolvedValue(ACCOUNT_A);
    const sendText = vi.fn().mockResolvedValue(undefined);
    accountsMocks.getAccountClient.mockResolvedValue({ sendText });

    // DB also needs to support the INSERT messages_log
    const db = {
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          run: async () => ({ meta: {} }),
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        run: async () => ({ meta: {} }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '{"text":"hello"}' }),
      }),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(200);
    expect(sendText).toHaveBeenCalledWith('igsid-1', 'hello');
  });
});

describe('POST /api/friends/:id/tags account-scope (FIX-A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(g) cross-account friend → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    const db = makeDb({ account_id: 'account-B' }); // ownership row returns B

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/2/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: 'tag-1' }),
      }),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  it('(h) in-scope friend → 201', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    const db = makeDb({ account_id: 'account-A' });
    dbMocks.addTagToFriend.mockResolvedValue(undefined);
    dbMocks.getScenarios.mockResolvedValue([]);

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/1/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: 'tag-1' }),
      }),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/friends/:id/tags/:tagId account-scope (FIX-A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(i) cross-account friend → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    const db = makeDb({ account_id: 'account-B' });

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/2/tags/tag-1', {
        method: 'DELETE',
      }),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  it('(j) in-scope friend → 200', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    const db = makeDb({ account_id: 'account-A' });
    dbMocks.removeTagFromFriend.mockResolvedValue(undefined);

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/1/tags/tag-1', {
        method: 'DELETE',
      }),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/friends/:id/metadata account-scope (FIX-A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(k) cross-account friend → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getFriendById.mockResolvedValue(FRIEND_CROSS_ACCOUNT);

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/2/metadata', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value' }),
      }),
      makeEnv(makeDb()),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  it('(l) in-scope friend → 200', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getFriendById
      .mockResolvedValueOnce(FRIEND_IN_SCOPE)  // initial fetch
      .mockResolvedValueOnce(FRIEND_IN_SCOPE); // re-fetch after update
    dbMocks.getFriendTags.mockResolvedValue([]);

    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({
          run: async () => ({ meta: {} }),
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
        run: async () => ({ meta: {} }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;

    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/1/metadata', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_field: 'hello' }),
      }),
      makeEnv(db),
      executionCtx,
    );
    expect(res.status).toBe(200);
  });
});

describe('No account resolved → 404 on all single-friend routes (FIX-A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('GET /api/friends/:id no account → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(null);
    const res = await friends.fetch(
      new Request('https://worker.example.com/api/friends/1'),
      makeEnv(makeDb()),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });
});
