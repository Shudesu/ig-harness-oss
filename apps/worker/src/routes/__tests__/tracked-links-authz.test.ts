/**
 * Tests: account ownership check on GET/DELETE /api/tracked-links/:id (FIX-B)
 *
 * Verifies that:
 * (a) GET /api/tracked-links/:id cross-account → 404
 * (b) GET /api/tracked-links/:id in-scope → 200
 * (c) DELETE /api/tracked-links/:id cross-account → 404
 * (d) DELETE /api/tracked-links/:id in-scope → 200
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic imports
// ---------------------------------------------------------------------------

const dbMocks = vi.hoisted(() => ({
  addTagToFriend: vi.fn(),
  createTrackedLink: vi.fn(),
  deleteTrackedLink: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getFriendByIgsid: vi.fn(),
  getLinkClicks: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getTrackedLinks: vi.fn(),
  recordLinkClick: vi.fn(),
}));

vi.mock('@ig-harness/db', () => dbMocks);

const accountsMocks = vi.hoisted(() => ({
  resolveAccount: vi.fn(),
}));

vi.mock('../../lib/accounts.js', () => accountsMocks);

import { trackedLinks } from '../tracked-links.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_A = { id: 'account-A', ig_user_id: 'ig-A', username: 'acct_a', access_token: 'tok', is_active: 1, is_default: 1 };

const LINK_IN_SCOPE = {
  id: 'link-1',
  name: 'My Link',
  original_url: 'https://example.com',
  tag_id: null,
  scenario_id: null,
  is_active: 1,
  click_count: 0,
  account_id: 'account-A',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const LINK_CROSS_ACCOUNT = {
  ...LINK_IN_SCOPE,
  id: 'link-2',
  account_id: 'account-B',
};

function makeEnv() {
  return {
    DB: {} as D1Database,
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

describe('GET /api/tracked-links/:id ownership check (FIX-B)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(a) cross-account link → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getTrackedLinkById.mockResolvedValue(LINK_CROSS_ACCOUNT);

    const res = await trackedLinks.fetch(
      new Request('https://worker.example.com/api/tracked-links/link-2'),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('not found');
  });

  it('(b) in-scope link → 200', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getTrackedLinkById.mockResolvedValue(LINK_IN_SCOPE);
    dbMocks.getLinkClicks.mockResolvedValue([]);

    const res = await trackedLinks.fetch(
      new Request('https://worker.example.com/api/tracked-links/link-1'),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe('DELETE /api/tracked-links/:id ownership check (FIX-B)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(c) cross-account link → 404', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getTrackedLinkById.mockResolvedValue(LINK_CROSS_ACCOUNT);

    const res = await trackedLinks.fetch(
      new Request('https://worker.example.com/api/tracked-links/link-2', { method: 'DELETE' }),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(404);
    expect(dbMocks.deleteTrackedLink).not.toHaveBeenCalled();
  });

  it('(d) in-scope link → 200 and delete called', async () => {
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getTrackedLinkById.mockResolvedValue(LINK_IN_SCOPE);
    dbMocks.deleteTrackedLink.mockResolvedValue(undefined);

    const res = await trackedLinks.fetch(
      new Request('https://worker.example.com/api/tracked-links/link-1', { method: 'DELETE' }),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(200);
    expect(dbMocks.deleteTrackedLink).toHaveBeenCalledWith(expect.anything(), 'link-1');
  });
});
