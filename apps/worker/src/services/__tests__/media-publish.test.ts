import { it, expect, vi } from 'vitest';
import { createMediaPost, getMediaPostById } from '@ig-harness/db';
import { InstagramApiError } from '@ig-harness/ig-sdk';
import { processMediaPosts, kickImmediate } from '../media-publish.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
async function fixture(type: 'feed_image' | 'carousel' | 'reel' | 'story' = 'feed_image') {
    const f = await gateFixture();
    const media = type === 'carousel' ? [{ url: 'https://example.com/1.jpg', type: 'image' as const }, { url: 'https://example.com/2.mp4', type: 'video' as const }] : [{ url: 'https://example.com/1.jpg', type: 'image' as const }];
    const post = await createMediaPost(f.db, { accountId: 'a', postType: type, media, caption: 'Caption', scheduledAt: new Date(Date.now() - 1000).toISOString() });
    let next = 0;
    const client = { getPublishingLimit: vi.fn(async () => ({ quota_usage: 0, config: { quota_total: 100 } })), createMediaContainer: vi.fn(async (..._args: unknown[]) => ({ id: `container-${++next}` })), getContainerStatus: vi.fn(async (_id: string) => ({ status_code: 'FINISHED' })), publishMedia: vi.fn(async (_id: string) => ({ id: 'published-1' })) };
    return { ...f, post, client, row: () => getMediaPostById(f.db, post.id) };
}
it('creates and publishes a ready image once', async () => { const f = await fixture(); try {
    await processMediaPosts(f.db, f.client as any, 'a');
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.createMediaContainer).toHaveBeenCalledOnce();
    expect(f.client.publishMedia).toHaveBeenCalledOnce();
    expect((await f.row())?.status).toBe('published');
}
finally {
    f.sqlite.close();
} });
it('waits for every carousel child before creating its parent', async () => { const f = await fixture('carousel'); try {
    f.client.getContainerStatus.mockResolvedValue({ status_code: 'IN_PROGRESS' });
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.createMediaContainer).toHaveBeenCalledTimes(2);
    expect((await f.row())?.child_creation_ids).toBe('["container-1","container-2"]');
    expect(f.client.publishMedia).not.toHaveBeenCalled();
    f.client.getContainerStatus.mockResolvedValue({ status_code: 'FINISHED' });
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.createMediaContainer).toHaveBeenLastCalledWith({ mediaType: 'CAROUSEL', children: ['container-1', 'container-2'], caption: 'Caption' });
    expect(f.client.publishMedia).not.toHaveBeenCalled();
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.publishMedia).toHaveBeenCalledOnce();
}
finally {
    f.sqlite.close();
} });
it('keeps an exhausted quota scheduled without creating containers', async () => { const f = await fixture(); try {
    f.client.getPublishingLimit.mockResolvedValue({ quota_usage: 100, config: { quota_total: 100 } });
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.createMediaContainer).not.toHaveBeenCalled();
    expect((await f.row())?.status).toBe('scheduled');
}
finally {
    f.sqlite.close();
} });
it('leaves an IN_PROGRESS parent for a later tick', async () => { const f = await fixture(); try {
    f.client.getContainerStatus.mockResolvedValue({ status_code: 'IN_PROGRESS' });
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.publishMedia).not.toHaveBeenCalled();
    expect((await f.row())?.status).toBe('processing');
}
finally {
    f.sqlite.close();
} });
it('fails terminal child errors without creating a parent', async () => { const f = await fixture('carousel'); try {
    f.client.getContainerStatus.mockResolvedValue({ status_code: 'ERROR' });
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.createMediaContainer).toHaveBeenCalledTimes(2);
    expect((await f.row())?.status).toBe('failed');
}
finally {
    f.sqlite.close();
} });
it('fails an expired parent without publishing', async () => { const f = await fixture(); try {
    f.client.getContainerStatus.mockResolvedValue({ status_code: 'EXPIRED' });
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.publishMedia).not.toHaveBeenCalled();
    expect((await f.row())?.error).toContain('EXPIRED');
}
finally {
    f.sqlite.close();
} });
it('recovers a PUBLISHED container without another publish request', async () => { const f = await fixture(); try {
    f.client.getContainerStatus.mockResolvedValue({ status_code: 'PUBLISHED' });
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.publishMedia).not.toHaveBeenCalled();
    expect((await f.row())?.status).toBe('published');
}
finally {
    f.sqlite.close();
} });
it('never retries an ambiguous publication', async () => { const f = await fixture(); try {
    f.client.publishMedia.mockRejectedValue(new Error('network'));
    await processMediaPosts(f.db, f.client as any, 'a');
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.publishMedia).toHaveBeenCalledOnce();
    expect(await f.row()).toMatchObject({ status: 'failed', phase: 'uncertain' });
}
finally {
    f.sqlite.close();
} });
it('caps failures of read-only quota probes', async () => { const f = await fixture(); try {
    f.client.getPublishingLimit.mockRejectedValue(new Error('offline'));
    for (let i = 0; i < 3; i++)
        await processMediaPosts(f.db, f.client as any, 'a');
    expect(await f.row()).toMatchObject({ status: 'failed', attempt_count: 3 });
    expect(f.client.createMediaContainer).not.toHaveBeenCalled();
}
finally {
    f.sqlite.close();
} });
it('surfaces typed publishing permission errors', async () => { const f = await fixture(); try {
    f.client.createMediaContainer.mockRejectedValue(new InstagramApiError('denied', 403, 10));
    await processMediaPosts(f.db, f.client as any, 'a');
    expect((await f.row())?.error).toContain('instagram_business_content_publish');
    expect((await f.row())?.phase).toBe('rejected');
}
finally {
    f.sqlite.close();
} });
it('claims concurrent ticks so each child/parent/publication happens once', async () => { const f = await fixture('carousel'); try {
    await Promise.all([processMediaPosts(f.db, f.client as any, 'a'), processMediaPosts(f.db, f.client as any, 'a')]);
    await processMediaPosts(f.db, f.client as any, 'a');
    await processMediaPosts(f.db, f.client as any, 'a');
    expect(f.client.createMediaContainer).toHaveBeenCalledTimes(3);
    expect(f.client.publishMedia).toHaveBeenCalledOnce();
}
finally {
    f.sqlite.close();
} });
it('immediate kicks do not replay already published posts', async () => { const f = await fixture(); try {
    await kickImmediate(f.db, f.client as any, f.post.id);
    await kickImmediate(f.db, f.client as any, f.post.id);
    expect(f.client.publishMedia).toHaveBeenCalledOnce();
}
finally {
    f.sqlite.close();
} });
it('does not leave an incomplete legacy processing carousel spinning forever',async()=>{
 const f=await fixture('carousel');try{f.sqlite.exec("UPDATE media_posts SET status='processing',phase='pending',creation_id=NULL,child_creation_ids=NULL");await processMediaPosts(f.db,f.client as any,'a');expect((await f.row())?.status).toBe('failed');expect(f.client.createMediaContainer).not.toHaveBeenCalled();}finally{f.sqlite.close();}
});
