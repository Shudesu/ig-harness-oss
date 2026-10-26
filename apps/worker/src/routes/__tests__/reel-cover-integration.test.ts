import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramClient } from '@ig-harness/ig-sdk';
import { getMediaPostById } from '@ig-harness/db';
import { processMediaPosts } from '../../services/media-publish.js';

vi.mock('../../lib/accounts.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ id: 'a' }),
  getAccountClient: vi.fn(),
}));
import { mediaPosts } from '../media-posts.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';

afterEach(() => vi.unstubAllGlobals());

describe('reel cover: HTTP input → persisted JSON → cron → Meta request', () => {
  it.each([
    { input: { cover_url: 'https://example.com/cover.jpg' }, saved: { coverUrl: 'https://example.com/cover.jpg' } },
    { input: { thumb_offset: 0 }, saved: { thumbOffset: 0 } },
  ])('keeps $input across scheduling and publishes exactly once', async ({ input, saved }) => {
    const { sqlite, db } = await gateFixture();
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/content_publishing_limit')) return Response.json({ data: [{ quota_usage: 0 }] });
      if (parsed.pathname.endsWith('/media')) return Response.json({ id: 'container-1' });
      if (parsed.pathname.endsWith('/container-1')) return Response.json({ id: 'container-1', status_code: 'FINISHED' });
      if (parsed.pathname.endsWith('/media_publish')) return Response.json({ id: 'published-1' });
      throw new Error(`unexpected request ${parsed.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await mediaPosts.request('/api/media-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_type: 'reel',
          media: [{ type: 'video', url: 'https://example.com/v.mp4', ...input }],
          scheduled_at: '2026-09-07T09:00:00+09:00',
        }),
      }, { DB: db });
      expect(res.status).toBe(201);
      const created = await res.json() as { data: { id: string; media: unknown[] } };
      expect(created.data.media[0]).toMatchObject(saved);
      const stored = await getMediaPostById(db, created.data.id);
      expect(JSON.parse(stored!.media)[0]).toMatchObject(saved);
      expect(fetchMock).not.toHaveBeenCalled();
      const client = new InstagramClient({ accessToken: 'test-token', igUserId: 'ig-1' });
      await processMediaPosts(db, client, 'a', '2026-09-07T09:05:00.000+09:00');
      const container = fetchMock.mock.calls.map(([url]) => new URL(url)).find((url) => url.pathname.endsWith('/media'))!;
      for (const [key, value] of Object.entries(input)) expect(container.searchParams.get(key)).toBe(String(value));
      expect((await getMediaPostById(db, created.data.id))?.status).toBe('published');
      await processMediaPosts(db, client, 'a', '2026-09-07T09:10:00.000+09:00');
      expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/media_publish'))).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });
});
