import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstagramClient } from './client.js';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('InstagramClient content publishing', () => {
  let client: InstagramClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    client = new InstagramClient({ accessToken: 'TOKEN', igUserId: 'IGUSER' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createMediaContainer: single image builds image_url + caption query', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'container-1' }));
    const result = await client.createMediaContainer({
      imageUrl: 'https://example.com/a.jpg',
      caption: 'hello #world',
    });
    expect(result.id).toBe('container-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe('/v25.0/IGUSER/media');
    expect(parsed.searchParams.get('image_url')).toBe('https://example.com/a.jpg');
    expect(parsed.searchParams.get('caption')).toBe('hello #world');
  });

  it('createMediaContainer: story video sets media_type=STORIES + video_url', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'container-2' }));
    await client.createMediaContainer({
      videoUrl: 'https://example.com/v.mp4',
      mediaType: 'STORIES',
    });
    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.searchParams.get('media_type')).toBe('STORIES');
    expect(parsed.searchParams.get('video_url')).toBe('https://example.com/v.mp4');
  });

  it('createMediaContainer: carousel parent sets children csv + media_type=CAROUSEL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'parent-1' }));
    await client.createMediaContainer({
      mediaType: 'CAROUSEL',
      children: ['c1', 'c2', 'c3'],
      caption: 'carousel',
    });
    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.searchParams.get('media_type')).toBe('CAROUSEL');
    expect(parsed.searchParams.get('children')).toBe('c1,c2,c3');
  });

  it('createMediaContainer: carousel item sets is_carousel_item=true', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'child-1' }));
    await client.createMediaContainer({
      imageUrl: 'https://example.com/a.jpg',
      isCarouselItem: true,
    });
    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.searchParams.get('is_carousel_item')).toBe('true');
  });

  it.each([0, 1500])('sends a reel frame offset of %s milliseconds', async (thumbOffset) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'reel' }));
    await client.createMediaContainer({ mediaType: 'REELS', videoUrl: 'https://example.com/v.mp4', thumbOffset });
    const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(params.get('thumb_offset')).toBe(String(thumbOffset));
    expect(params.has('cover_url')).toBe(false);
  });

  it('sends cover_url intact and gives it precedence over thumb_offset', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'reel' }));
    const coverUrl = 'https://example.com/cover.jpg?x=1&y=2';
    await client.createMediaContainer({ mediaType: 'REELS', coverUrl, thumbOffset: 0 });
    const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(params.get('cover_url')).toBe(coverUrl);
    expect(params.has('thumb_offset')).toBe(false);
  });

  it.each(['STORIES', 'VIDEO', 'CAROUSEL'] as const)('does not send reel cover fields for %s', async (mediaType) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'other' }));
    await client.createMediaContainer({ mediaType, coverUrl: 'https://example.com/c.jpg', thumbOffset: 0 });
    const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(params.has('cover_url')).toBe(false);
    expect(params.has('thumb_offset')).toBe(false);
  });

  it('preserves the default reel request without cover options', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'reel' }));
    await client.createMediaContainer({ mediaType: 'REELS', videoUrl: 'https://example.com/v.mp4' });
    const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(params.has('cover_url')).toBe(false);
    expect(params.has('thumb_offset')).toBe(false);
  });

  it('getContainerStatus requests status_code,status fields', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'container-1', status_code: 'FINISHED' }),
    );
    const status = await client.getContainerStatus('container-1');
    expect(status.status_code).toBe('FINISHED');
    const parsed = new URL(fetchMock.mock.calls[0][0] as string);
    expect(parsed.pathname).toBe('/v25.0/container-1');
    expect(parsed.searchParams.get('fields')).toBe('status_code,status');
  });

  it('publishMedia posts creation_id to /media_publish', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'media-99' }));
    const result = await client.publishMedia('container-1');
    expect(result.id).toBe('media-99');
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe('/v25.0/IGUSER/media_publish');
    expect(parsed.searchParams.get('creation_id')).toBe('container-1');
  });

  it('getPublishingLimit unwraps data[0]', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }],
      }),
    );
    const limit = await client.getPublishingLimit();
    expect(limit.quota_usage).toBe(3);
    expect(limit.config?.quota_total).toBe(100);
  });

  it('propagates Graph API errors with status and body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":{"message":"(#10) Permission denied"}}', { status: 403 }),
    );
    await expect(
      client.createMediaContainer({ imageUrl: 'https://example.com/a.jpg' }),
    ).rejects.toThrow(/403/);
  });
});
