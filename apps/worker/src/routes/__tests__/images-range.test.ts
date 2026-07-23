/**
 * Tests: GET /images/:key Range support (final review Fix 3) — Meta's video
 * fetcher probes hosted files with range/length semantics before ingesting
 * them for reels/video stories.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../../index.js';

vi.mock('@ig-harness/db', () => ({
  getFriendByIgsid: vi.fn(),
  getIgAccountById: vi.fn(),
  getDefaultIgAccount: vi.fn(),
}));

vi.mock('../../lib/accounts.js', () => ({
  getAccountClient: vi.fn(),
}));

import { images, parseByteRange } from '../images.js';

function mockEnv(imagesMock: Partial<R2Bucket>): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: imagesMock as R2Bucket,
    ASSETS: {} as Fetcher,
    IG_APP_SECRET: 'test-secret',
    IG_ACCESS_TOKEN: 'test-token',
    IG_USER_ID: '123',
    IG_VERIFY_TOKEN: 'test-verify',
    API_KEY: 'test-key',
    WORKER_URL: 'https://test.workers.dev',
  };
}

const executionCtx = {
  waitUntil: (p: Promise<unknown>) => {
    p.catch(() => {});
  },
  passThroughOnException: () => {},
} as ExecutionContext;

function makeBody(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const FULL_SIZE = 1000;

describe('GET /images/:key', () => {
  it('sets Content-Length and Accept-Ranges on a full (unranged) response', async () => {
    const body = new Uint8Array(FULL_SIZE);
    const get = vi.fn().mockResolvedValue({
      body: makeBody(body),
      size: FULL_SIZE,
      etag: 'etag-1',
      httpMetadata: { contentType: 'video/mp4' },
    });

    const res = await images.fetch(
      new Request('https://worker.example.com/images/video-key.mp4'),
      mockEnv({ get: get as never }),
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe(String(FULL_SIZE));
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(get).toHaveBeenCalledWith('video-key.mp4');
  });

  it('serves a satisfiable range as 206 with correct Content-Range/Content-Length', async () => {
    const slice = new Uint8Array(101); // bytes 100-200 inclusive
    const head = vi.fn().mockResolvedValue({ size: FULL_SIZE });
    const get = vi.fn().mockResolvedValue({
      body: makeBody(slice),
      size: FULL_SIZE, // R2 still reports full size on a ranged get
      etag: 'etag-1',
      httpMetadata: { contentType: 'video/mp4' },
    });

    const res = await images.fetch(
      new Request('https://worker.example.com/images/video-key.mp4', {
        headers: { Range: 'bytes=100-200' },
      }),
      mockEnv({ head: head as never, get: get as never }),
      executionCtx,
    );

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 100-200/${FULL_SIZE}`);
    expect(res.headers.get('Content-Length')).toBe('101');
    expect(get).toHaveBeenCalledWith('video-key.mp4', { range: { offset: 100, length: 101 } });
  });

  it('returns 416 with Content-Range: bytes */total for an unsatisfiable range', async () => {
    const head = vi.fn().mockResolvedValue({ size: FULL_SIZE });
    const get = vi.fn();

    const res = await images.fetch(
      new Request('https://worker.example.com/images/video-key.mp4', {
        headers: { Range: 'bytes=5000-6000' },
      }),
      mockEnv({ head: head as never, get: get as never }),
      executionCtx,
    );

    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${FULL_SIZE}`);
    expect(get).not.toHaveBeenCalled();
  });

  it('404s when the key does not exist (unranged)', async () => {
    const get = vi.fn().mockResolvedValue(null);
    const res = await images.fetch(
      new Request('https://worker.example.com/images/missing.mp4'),
      mockEnv({ get: get as never }),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });

  it('404s when the key does not exist (ranged)', async () => {
    const head = vi.fn().mockResolvedValue(null);
    const res = await images.fetch(
      new Request('https://worker.example.com/images/missing.mp4', {
        headers: { Range: 'bytes=0-10' },
      }),
      mockEnv({ head: head as never }),
      executionCtx,
    );
    expect(res.status).toBe(404);
  });
});

describe('parseByteRange', () => {
  it('parses a standard start-end range', () => {
    expect(parseByteRange('bytes=100-200', 1000)).toEqual({ start: 100, end: 200 });
  });
  it('parses an open-ended range', () => {
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
  });
  it('parses a suffix range', () => {
    expect(parseByteRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 });
  });
  it('clamps an end beyond size to size-1', () => {
    expect(parseByteRange('bytes=100-99999', 1000)).toEqual({ start: 100, end: 999 });
  });
  it('rejects a start beyond size', () => {
    expect(parseByteRange('bytes=5000-6000', 1000)).toBeNull();
  });
  it('rejects malformed headers', () => {
    expect(parseByteRange('not-a-range', 1000)).toBeNull();
    expect(parseByteRange('bytes=-', 1000)).toBeNull();
  });
});
