import { describe, it, expect, vi } from 'vitest';
import { handleNotFound } from '../index.js';

// Regression test for Shudesu/ig-harness-oss issue #3:
//   "TypeError: Cannot read properties of undefined (reading 'fetch')"
//
// create-ig-harness's deploy template omits [assets], so `env.ASSETS` is
// undefined at runtime. The notFound fallback used to call
// `env.ASSETS.fetch(...)` unconditionally and throw.

describe('handleNotFound (issue #3 regression)', () => {
  it('does NOT call fetch on an undefined ASSETS binding for GET /', async () => {
    const res = await handleNotFound(new Request('https://example.workers.dev/'), undefined);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body).toEqual({ success: false, error: 'Not found' });
  });

  it('returns JSON 404 for unknown API paths even when ASSETS is undefined', async () => {
    const res = await handleNotFound(
      new Request('https://example.workers.dev/api/does-not-exist'),
      undefined,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('delegates non-API paths to ASSETS.fetch when the binding IS present', async () => {
    const fetcher = { fetch: vi.fn().mockResolvedValue(new Response('hi', { status: 200 })) };
    const req = new Request('https://example.workers.dev/');

    const res = await handleNotFound(req, fetcher as unknown as Fetcher);

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(fetcher.fetch).toHaveBeenCalledWith(req);
    expect(res.status).toBe(200);
  });

  it('never delegates /api/* to ASSETS even when present', async () => {
    const fetcher = { fetch: vi.fn() };
    const res = await handleNotFound(
      new Request('https://example.workers.dev/api/missing'),
      fetcher as unknown as Fetcher,
    );
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });
});
