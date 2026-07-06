import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../index.js';

// Mock DB functions before importing route
vi.mock('@ig-harness/db', () => ({
  getFriendByIgsid: vi.fn(),
  getIgAccountById: vi.fn(),
  getDefaultIgAccount: vi.fn(),
}));

// Mock accounts lib
vi.mock('../../lib/accounts.js', () => ({
  getAccountClient: vi.fn(),
}));

import { getFriendByIgsid, getIgAccountById, getDefaultIgAccount } from '@ig-harness/db';
import { getAccountClient } from '../../lib/accounts.js';
import { images } from '../images.js';

function mockEnv(overrides: Record<string, unknown> = {}): Env['Bindings'] {
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

function makeR2Object(cachedAt: string, body: Uint8Array, contentType = 'image/jpeg'): R2ObjectBody {
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      }
    }),
    httpMetadata: { contentType },
    customMetadata: { cachedAt },
    arrayBuffer: async () => body.buffer,
  } as unknown as R2ObjectBody;
}

describe('GET /images/profile-pics/:igsid', () => {
  it('R2 fresh hit — serves from cache without calling getFriendByIgsid', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const freshCachedAt = new Date().toISOString(); // now = fresh
    const r2Object = makeR2Object(freshCachedAt, imageBytes);

    const mockImages = {
      get: vi.fn().mockResolvedValue(r2Object),
      put: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    };

    const env = mockEnv({ IMAGES: mockImages as unknown as R2Bucket });

    const res = await images.request('/images/profile-pics/igsid-abc', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    // Must NOT call getFriendByIgsid on a fresh cache hit
    expect(vi.mocked(getFriendByIgsid)).not.toHaveBeenCalled();
    expect(vi.mocked(getAccountClient)).not.toHaveBeenCalled();
  });

  it('Cache miss → fetch from IG Graph, store to R2, serve image', async () => {
    const imageBytes = new Uint8Array([10, 20, 30]);

    const mockImages = {
      get: vi.fn().mockResolvedValue(null), // cache miss
      put: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      delete: vi.fn(),
    };

    const fakeAccount = { id: 'acc-1', ig_user_id: '999' };
    const fakeIgClient = {
      getUserProfile: vi.fn().mockResolvedValue({
        id: 'igsid-xyz',
        username: 'testuser',
        name: 'Test User',
        profile_pic: 'https://cdn.example.com/pic.jpg',
      }),
    };

    vi.mocked(getFriendByIgsid).mockResolvedValue({
      id: 1,
      igsid: 'igsid-xyz',
      account_id: 'acc-1',
    } as never);
    vi.mocked(getIgAccountById).mockResolvedValue(fakeAccount as never);
    vi.mocked(getDefaultIgAccount).mockResolvedValue(fakeAccount as never);
    vi.mocked(getAccountClient).mockResolvedValue(fakeIgClient as never);

    // Mock global fetch for CDN URL
    const cdnResponse = new Response(imageBytes, {
      headers: { 'Content-Type': 'image/jpeg' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cdnResponse));

    const env = mockEnv({ IMAGES: mockImages as unknown as R2Bucket });

    const res = await images.request('/images/profile-pics/igsid-xyz', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    // Should have stored to R2
    expect(mockImages.put).toHaveBeenCalledWith(
      'profile-pics/igsid-xyz',
      expect.anything(),
      expect.objectContaining({
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: expect.objectContaining({ cachedAt: expect.any(String) }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('Unknown IGSID (no follower row) — 404 without spending a Graph call', async () => {
    vi.clearAllMocks(); // earlier cases' call history must not leak into the not-called assertions
    const mockImages = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(getFriendByIgsid).mockResolvedValue(null as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const env = mockEnv({ IMAGES: mockImages as unknown as R2Bucket });
    const res = await images.request('/images/profile-pics/probe-attempt', {}, env);

    expect(res.status).toBe(404);
    expect(getAccountClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('Graph fail + stale R2 object — serves stale without throwing', async () => {
    const imageBytes = new Uint8Array([99, 88, 77]);
    // 60 days ago = stale (>30 days)
    const staleCachedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const staleR2Object = makeR2Object(staleCachedAt, imageBytes);

    const mockImages = {
      get: vi.fn().mockResolvedValue(staleR2Object),
      put: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    };

    // Graph call should fail
    const fakeAccount = { id: 'acc-1', ig_user_id: '999' };
    const fakeIgClient = {
      getUserProfile: vi.fn().mockRejectedValue(new Error('Graph API error')),
    };

    vi.mocked(getFriendByIgsid).mockResolvedValue(null);
    vi.mocked(getDefaultIgAccount).mockResolvedValue(fakeAccount as never);
    vi.mocked(getAccountClient).mockResolvedValue(fakeIgClient as never);

    const env = mockEnv({ IMAGES: mockImages as unknown as R2Bucket });

    const res = await images.request('/images/profile-pics/igsid-stale', {}, env);

    // Should serve stale, not 500
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('Nothing available — R2 null, graph fails → 404 JSON', async () => {
    const mockImages = {
      get: vi.fn().mockResolvedValue(null), // no cache
      put: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    };

    vi.mocked(getFriendByIgsid).mockResolvedValue(null);
    vi.mocked(getDefaultIgAccount).mockResolvedValue(null); // no account either

    const env = mockEnv({ IMAGES: mockImages as unknown as R2Bucket });

    const res = await images.request('/images/profile-pics/igsid-404', {}, env);

    expect(res.status).toBe(404);
    const body = await res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Profile picture not available');
  });
});
