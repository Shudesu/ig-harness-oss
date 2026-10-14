/**
 * Tests: media-publish state machine
 * scheduled → processing → published / failed, quota carry-over, retry cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ig-harness/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ig-harness/db')>();
  return {
    ...original,
    getDueMediaPosts: vi.fn().mockResolvedValue([]),
    getProcessingMediaPosts: vi.fn().mockResolvedValue([]),
    getMediaPostById: vi.fn().mockResolvedValue(null),
    claimScheduledMediaPost: vi.fn().mockResolvedValue(null),
    claimProcessingMediaPost: vi.fn().mockResolvedValue(null),
    recoverStalledMediaPostStarts: vi.fn().mockResolvedValue(0),
    updateMediaPost: vi.fn().mockResolvedValue(null),
  };
});

import {
  getDueMediaPosts,
  getProcessingMediaPosts,
  getMediaPostById,
  claimScheduledMediaPost,
  claimProcessingMediaPost,
  recoverStalledMediaPostStarts,
  updateMediaPost,
} from '@ig-harness/db';
import { processMediaPosts, kickImmediate } from '../media-publish.js';

const db = {} as D1Database;

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    account_id: 'acc-1',
    post_type: 'feed_image',
    media: JSON.stringify([{ url: 'https://example.com/a.jpg', type: 'image' }]),
    caption: 'hi',
    status: 'scheduled',
    scheduled_at: '2026-07-23T10:00:00.000+09:00',
    creation_id: null,
    child_creation_ids: null,
    published_media_id: null,
    attempt_count: 0,
    error: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    getPublishingLimit: vi.fn().mockResolvedValue({ quota_usage: 0, config: { quota_total: 100, quota_duration: 86400 } }),
    createMediaContainer: vi.fn().mockResolvedValue({ id: 'container-1' }),
    getContainerStatus: vi.fn().mockResolvedValue({ id: 'container-1', status_code: 'FINISHED' }),
    publishMedia: vi.fn().mockResolvedValue({ id: 'media-99' }),
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimScheduledMediaPost).mockImplementation(async (_db, id) =>
    makePost({ id, status: 'processing' }) as any,
  );
  vi.mocked(claimProcessingMediaPost).mockImplementation(
    async (_db, id, _expectedScheduledAt, leaseUntil) =>
      makePost({ id, status: 'processing', creation_id: 'container-1', scheduled_at: leaseUntil }) as any,
  );
  vi.mocked(recoverStalledMediaPostStarts).mockResolvedValue(0);
});

describe('processMediaPosts — scheduled posts', () => {
  it('creates a container for a due feed image and moves it to processing', async () => {
    vi.mocked(getDueMediaPosts).mockResolvedValueOnce([makePost()] as any);
    const client = makeClient();
    await processMediaPosts(db, client, 'acc-1');
    expect(client.createMediaContainer).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: 'https://example.com/a.jpg', caption: 'hi' }),
    );
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ status: 'processing', creation_id: 'container-1' }),
    );
  });

  it('carousel: creates child containers first, then parent with children ids', async () => {
    const post = makePost({
      post_type: 'carousel',
      media: JSON.stringify([
        { url: 'https://example.com/1.jpg', type: 'image' },
        { url: 'https://example.com/2.mp4', type: 'video' },
      ]),
    });
    vi.mocked(getDueMediaPosts).mockResolvedValueOnce([post] as any);
    const client = makeClient();
    client.createMediaContainer
      .mockResolvedValueOnce({ id: 'child-1' })
      .mockResolvedValueOnce({ id: 'child-2' })
      .mockResolvedValueOnce({ id: 'parent-1' });
    await processMediaPosts(db, client, 'acc-1');
    expect(client.createMediaContainer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ imageUrl: 'https://example.com/1.jpg', isCarouselItem: true }),
    );
    expect(client.createMediaContainer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ videoUrl: 'https://example.com/2.mp4', mediaType: 'VIDEO', isCarouselItem: true }),
    );
    expect(client.createMediaContainer).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ mediaType: 'CAROUSEL', children: ['child-1', 'child-2'] }),
    );
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({
        status: 'processing',
        creation_id: 'parent-1',
        child_creation_ids: JSON.stringify(['child-1', 'child-2']),
      }),
    );
  });

  it('quota exhausted: stays scheduled with an error note, no container created', async () => {
    vi.mocked(getDueMediaPosts).mockResolvedValueOnce([makePost()] as any);
    const client = makeClient({
      getPublishingLimit: vi.fn().mockResolvedValue({ quota_usage: 100, config: { quota_total: 100, quota_duration: 86400 } }),
    });
    await processMediaPosts(db, client, 'acc-1');
    expect(client.createMediaContainer).not.toHaveBeenCalled();
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ status: 'scheduled' }),
    );
  });

  it('container creation failure increments attempt_count, keeps scheduled', async () => {
    vi.mocked(getDueMediaPosts).mockResolvedValueOnce([makePost()] as any);
    const client = makeClient({
      createMediaContainer: vi.fn().mockRejectedValue(new Error('Instagram API error 400: bad url')),
    });
    await processMediaPosts(db, client, 'acc-1');
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ attempt_count: 1 }),
    );
  });

  it('3rd failure marks the post failed', async () => {
    vi.mocked(getDueMediaPosts).mockResolvedValueOnce([makePost({ attempt_count: 2 })] as any);
    vi.mocked(claimScheduledMediaPost).mockResolvedValueOnce(
      makePost({ status: 'processing', attempt_count: 2 }) as any,
    );
    const client = makeClient({
      createMediaContainer: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await processMediaPosts(db, client, 'acc-1');
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ status: 'failed', attempt_count: 3 }),
    );
  });

  it('permission error message mentions the missing scope', async () => {
    vi.mocked(getDueMediaPosts).mockResolvedValueOnce([makePost({ attempt_count: 2 })] as any);
    vi.mocked(claimScheduledMediaPost).mockResolvedValueOnce(
      makePost({ status: 'processing', attempt_count: 2 }) as any,
    );
    const client = makeClient({
      createMediaContainer: vi.fn().mockRejectedValue(
        new Error('Instagram API error 403: {"error":{"message":"(#10) Application does not have permission"}}'),
      ),
    });
    await processMediaPosts(db, client, 'acc-1');
    const failedCall = vi.mocked(updateMediaPost).mock.calls.find(
      (call) => (call[2] as any).status === 'failed',
    );
    expect(String((failedCall![2] as any).error)).toContain('instagram_business_content_publish');
  });
});

describe('processMediaPosts — processing posts', () => {
  it('FINISHED container is published', async () => {
    vi.mocked(getProcessingMediaPosts).mockResolvedValueOnce([
      makePost({ status: 'processing', creation_id: 'container-1' }),
    ] as any);
    const client = makeClient();
    await processMediaPosts(db, client, 'acc-1');
    expect(client.publishMedia).toHaveBeenCalledWith('container-1');
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ status: 'published', published_media_id: 'media-99' }),
    );
  });

  it('IN_PROGRESS container is left untouched for the next cycle', async () => {
    vi.mocked(getProcessingMediaPosts).mockResolvedValueOnce([
      makePost({ status: 'processing', creation_id: 'container-1' }),
    ] as any);
    const client = makeClient({
      getContainerStatus: vi.fn().mockResolvedValue({ id: 'container-1', status_code: 'IN_PROGRESS' }),
    });
    await processMediaPosts(db, client, 'acc-1');
    expect(client.publishMedia).not.toHaveBeenCalled();
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ scheduled_at: '2026-07-23T10:00:00.000+09:00' }),
    );
  });

  it('ERROR container marks the post failed', async () => {
    vi.mocked(getProcessingMediaPosts).mockResolvedValueOnce([
      makePost({ status: 'processing', creation_id: 'container-1' }),
    ] as any);
    const client = makeClient({
      getContainerStatus: vi.fn().mockResolvedValue({
        id: 'container-1',
        status_code: 'ERROR',
        status: 'Media upload failed',
      }),
    });
    await processMediaPosts(db, client, 'acc-1');
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('PUBLISHED container is recovered to published without re-publishing', async () => {
    vi.mocked(getProcessingMediaPosts).mockResolvedValueOnce([
      makePost({ status: 'processing', creation_id: 'container-1' }),
    ] as any);
    const client = makeClient({
      getContainerStatus: vi.fn().mockResolvedValue({ id: 'container-1', status_code: 'PUBLISHED' }),
    });
    await processMediaPosts(db, client, 'acc-1');
    expect(client.publishMedia).not.toHaveBeenCalled();
    expect(updateMediaPost).toHaveBeenCalledWith(
      db,
      'post-1',
      expect.objectContaining({ status: 'published' }),
    );
  });
});

describe('kickImmediate', () => {
  it('runs a full start+advance cycle so images publish without waiting for cron', async () => {
    const scheduled = makePost();
    const processing = makePost({ status: 'processing', creation_id: 'container-1' });
    vi.mocked(getMediaPostById)
      .mockResolvedValueOnce(scheduled as any)
      .mockResolvedValueOnce(processing as any);
    const client = makeClient();
    await kickImmediate(db, client, 'post-1');
    expect(client.createMediaContainer).toHaveBeenCalled();
    expect(client.publishMedia).toHaveBeenCalledWith('container-1');
  });

  it('does nothing when the post is not scheduled', async () => {
    vi.mocked(getMediaPostById).mockResolvedValueOnce(
      makePost({ status: 'published' }) as any,
    );
    const client = makeClient();
    await kickImmediate(db, client, 'post-1');
    expect(client.createMediaContainer).not.toHaveBeenCalled();
  });

  it('creates only one container when two immediate kicks race', async () => {
    const scheduled = makePost();
    vi.mocked(getMediaPostById).mockResolvedValue(scheduled as any);
    vi.mocked(claimScheduledMediaPost)
      .mockResolvedValueOnce(makePost({ status: 'processing' }) as any)
      .mockResolvedValueOnce(null);
    const client = makeClient();

    await Promise.all([
      kickImmediate(db, client, 'post-1'),
      kickImmediate(db, client, 'post-1'),
    ]);

    expect(claimScheduledMediaPost).toHaveBeenCalledTimes(2);
    expect(client.createMediaContainer).toHaveBeenCalledTimes(1);
  });
});

describe('processMediaPosts — concurrency', () => {
  it('publishes only once when two cron runs see the same processing post', async () => {
    const processing = makePost({ status: 'processing', creation_id: 'container-1' });
    vi.mocked(getProcessingMediaPosts).mockResolvedValue([processing] as any);
    vi.mocked(claimProcessingMediaPost)
      .mockResolvedValueOnce(processing as any)
      .mockResolvedValueOnce(null);
    const client = makeClient();

    await Promise.all([
      processMediaPosts(db, client, 'acc-1'),
      processMediaPosts(db, client, 'acc-1'),
    ]);

    expect(claimProcessingMediaPost).toHaveBeenCalledTimes(2);
    expect(client.publishMedia).toHaveBeenCalledTimes(1);
  });
});
