/**
 * Tests: POST /api/media-posts/:id/publish-now uses the post's OWNING
 * account, not the request-scoped ?account_id/default account (final review
 * Fix 1 — mirrors broadcasts.ts's /:id/send owning-account convention).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic imports
// ---------------------------------------------------------------------------

const dbMocks = vi.hoisted(() => ({
  getMediaPostById: vi.fn(),
  updateMediaPost: vi.fn(),
  cancelMediaPost: vi.fn(),
  createMediaPost: vi.fn(),
  listMediaPosts: vi.fn(),
  getIgAccountById: vi.fn(),
  jstNow: vi.fn().mockReturnValue('2026-01-01T00:00:00+09:00'),
  toJstString: vi.fn((d: Date) => d.toISOString()),
}));

vi.mock('@ig-harness/db', () => dbMocks);

const accountsMocks = vi.hoisted(() => ({
  resolveAccount: vi.fn(),
  getAccountClient: vi.fn(),
}));

vi.mock('../../lib/accounts.js', () => accountsMocks);

const mediaPublishMocks = vi.hoisted(() => ({
  kickImmediate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/media-publish.js', () => mediaPublishMocks);

import { mediaPosts } from '../media-posts.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_A = {
  id: 'account-A',
  ig_user_id: 'ig-A',
  username: 'acct_a',
  access_token: 'tok-a',
  is_active: 1,
  is_default: 1,
};
const ACCOUNT_B = {
  id: 'account-B',
  ig_user_id: 'ig-B',
  username: 'acct_b',
  access_token: 'tok-b',
  is_active: 1,
  is_default: 0,
};

const POST_OWNED_BY_B = {
  id: 'post-1',
  account_id: 'account-B',
  post_type: 'feed_image',
  media: '[]',
  caption: null,
  status: 'scheduled',
  scheduled_at: '2026-01-01T00:00:00+09:00',
  creation_id: null,
  child_creation_ids: null,
  published_media_id: null,
  attempt_count: 0,
  error: null,
  created_at: '2026-01-01T00:00:00+09:00',
  updated_at: '2026-01-01T00:00:00+09:00',
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
  waitUntil: (p: Promise<unknown>) => {
    p.catch(() => {});
  },
  passThroughOnException: () => {},
} as ExecutionContext;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/media-posts/:id/publish-now owning-account (Fix 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.updateMediaPost.mockResolvedValue({ ...POST_OWNED_BY_B, status: 'processing' });
  });

  it('builds the IG client from the post\'s owning account, not resolveAccount', async () => {
    // A request made with the "wrong" default/query account (A) must still
    // resolve to the post's real owner (B).
    accountsMocks.resolveAccount.mockResolvedValue(ACCOUNT_A);
    dbMocks.getMediaPostById.mockResolvedValue(POST_OWNED_BY_B);
    dbMocks.getIgAccountById.mockResolvedValue(ACCOUNT_B);
    accountsMocks.getAccountClient.mockResolvedValue({ fake: 'client' });

    const res = await mediaPosts.fetch(
      new Request('https://worker.example.com/api/media-posts/post-1/publish-now?account_id=account-A', {
        method: 'POST',
      }),
      makeEnv(),
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(dbMocks.getIgAccountById).toHaveBeenCalledWith(expect.anything(), 'account-B');
    expect(accountsMocks.getAccountClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ACCOUNT_B,
    );
    // resolveAccount must not gate this handler at all anymore.
    expect(accountsMocks.resolveAccount).not.toHaveBeenCalled();
  });

  it('404s when the owning account no longer exists', async () => {
    dbMocks.getMediaPostById.mockResolvedValue(POST_OWNED_BY_B);
    dbMocks.getIgAccountById.mockResolvedValue(null);

    const res = await mediaPosts.fetch(
      new Request('https://worker.example.com/api/media-posts/post-1/publish-now', {
        method: 'POST',
      }),
      makeEnv(),
      executionCtx,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('account not found');
    expect(accountsMocks.getAccountClient).not.toHaveBeenCalled();
  });

  it('409s when the post is not in scheduled status (checked before account lookup)', async () => {
    dbMocks.getMediaPostById.mockResolvedValue({ ...POST_OWNED_BY_B, status: 'published' });

    const res = await mediaPosts.fetch(
      new Request('https://worker.example.com/api/media-posts/post-1/publish-now', {
        method: 'POST',
      }),
      makeEnv(),
      executionCtx,
    );

    expect(res.status).toBe(409);
    expect(dbMocks.getIgAccountById).not.toHaveBeenCalled();
  });
});
