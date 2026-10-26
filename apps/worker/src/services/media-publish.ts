import { getDueMediaPosts, getProcessingMediaPosts, getMediaPostById, updateMediaPost, type MediaPost, type MediaPostMediaItem, jstNow } from '@ig-harness/db';
import { InstagramApiError, type InstagramClient } from '@ig-harness/ig-sdk';
const MAX_ATTEMPTS = 3;
const DEFAULT_QUOTA_TOTAL = 50; // Fallback only; prefer Meta's returned quota_total.
export async function processMediaPosts(db: D1Database, client: InstagramClient, accountId: string, now = jstNow()): Promise<void> {
    for (const post of await getDueMediaPosts(db, accountId, now))
        await startPost(db, client, post);
    for (const post of await getProcessingMediaPosts(db, accountId))
        await advancePost(db, client, post);
}
export async function kickImmediate(db: D1Database, client: InstagramClient, postId: string): Promise<void> {
    const post = await getMediaPostById(db, postId);
    if (!post || post.status !== 'scheduled' || !await startPost(db, client, post))
        return;
    const current = await getMediaPostById(db, postId);
    if (current?.status === 'processing')
        await advancePost(db, client, current);
}
async function claimPhase(db: D1Database, id: string, from: string, to: string): Promise<MediaPost | null> {
    const result = await db.prepare("UPDATE media_posts SET phase=?,phase_started_at=? WHERE id=? AND status='processing' AND phase=? RETURNING *")
        .bind(to, new Date().toISOString(), id, from).first<MediaPost>();
    return result;
}
async function startPost(db: D1Database, client: InstagramClient, post: MediaPost): Promise<boolean> {
    let claimed = false;
    try {
        const limit = await client.getPublishingLimit();
        const total = limit.config?.quota_total ?? DEFAULT_QUOTA_TOTAL;
        if (limit.quota_usage >= total) {
            await updateMediaPost(db, post.id, { error: `publishing quota exhausted (${limit.quota_usage}/${total}); will retry next cycle` });
            return false;
        }
        const result = await db.prepare("UPDATE media_posts SET status='processing',phase='creating',phase_started_at=? WHERE id=? AND status='scheduled'").bind(new Date().toISOString(), post.id).run();
        if (!result.meta.changes)
            return false;
        claimed = true;
        const media = JSON.parse(post.media) as MediaPostMediaItem[];
        if (post.post_type === 'carousel') {
            await updateMediaPost(db, post.id, { phase: 'children_pending', child_creation_ids: '[]', status: 'processing', error: null });
            await prepareChildren(db, client, { ...post, status: 'processing', phase: 'children_pending', child_creation_ids: '[]' });
            return true;
        }
        const item = media[0]!;
        const created = await client.createMediaContainer({
            imageUrl: item.type === 'image' ? item.url : undefined, videoUrl: item.type === 'video' ? item.url : undefined,
            ...(post.post_type === 'reel' ? { mediaType: 'REELS' as const, coverUrl: item.coverUrl, thumbOffset: item.thumbOffset } : post.post_type === 'story' ? { mediaType: 'STORIES' as const } : {}),
            ...(post.post_type === 'story' ? {} : { caption: post.caption ?? undefined }),
        });
        await updateMediaPost(db, post.id, { status: 'processing', phase: 'polling', creation_id: created.id, error: null });
        return true;
    }
    catch (error) {
        if (claimed)
            await mutationFailure(db, post, error, 'creation_unconfirmed');
        else
            await recordReadFailure(db, post, error);
        return false;
    }
}
async function prepareChildren(db: D1Database, client: InstagramClient, post: MediaPost): Promise<void> {
    const media = JSON.parse(post.media) as MediaPostMediaItem[];
    let ids = JSON.parse(post.child_creation_ids ?? '[]') as string[];
    const deadline = Date.now() + 15000;
    while (ids.length < media.length && Date.now() < deadline) {
        const claim = await claimPhase(db, post.id, 'children_pending', 'creating_child');
        if (!claim)
            return;
        ids = JSON.parse(claim.child_creation_ids ?? '[]') as string[];
        if (ids.length >= media.length) {
            await updateMediaPost(db, post.id, { phase: 'children_pending' });
            return;
        }
        const item = media[ids.length]!;
        try {
            const child = await client.createMediaContainer({ imageUrl: item.type === 'image' ? item.url : undefined, videoUrl: item.type === 'video' ? item.url : undefined, mediaType: item.type === 'video' ? 'VIDEO' : undefined, isCarouselItem: true });
            ids.push(child.id);
            await updateMediaPost(db, post.id, { child_creation_ids: JSON.stringify(ids), phase: 'children_pending', error: null });
        }
        catch (error) {
            await mutationFailure(db, post, error, 'child_creation_unconfirmed');
            return;
        }
    }
    // The next processor tick checks every child's status before creating a parent.
}
async function advancePost(db: D1Database, client: InstagramClient, post: MediaPost): Promise<void> {
    const phase = post.phase ?? 'pending';
    if (['creating', 'creating_child', 'creating_parent'].includes(phase)) {
        if (post.phase_started_at && Date.parse(post.phase_started_at) < Date.now() - 5 * 60000)
            await updateMediaPost(db, post.id, { status: 'failed', phase: 'uncertain', error: 'container_creation_unconfirmed: inspect the existing container before retrying' });
        return;
    }
    try {
        if (post.post_type === 'carousel' && !post.creation_id) {
            const ids = JSON.parse(post.child_creation_ids ?? '[]') as string[];
            const count = (JSON.parse(post.media) as MediaPostMediaItem[]).length;
            if (count < 2 || ids.length > count || (phase === 'pending' && ids.length < count)) {
                await updateMediaPost(db,post.id,{status:'failed',phase:'uncertain',error:'incomplete carousel state: inspect the saved children before retrying'});
                return;
            }
            if (ids.length < count) {
                await prepareChildren(db, client, post);
                return;
            }
            let ready = true;
            for (const id of ids) {
                const state = await client.getContainerStatus(id);
                if (['ERROR', 'EXPIRED', 'PUBLISHED'].includes(state.status_code)) {
                    await updateMediaPost(db, post.id, { status: 'failed', error: `carousel child ${state.status_code}` });
                    return;
                }
                if (state.status_code !== 'FINISHED')
                    ready = false;
            }
            if (!ready || !await claimPhase(db, post.id, phase, 'creating_parent'))
                return;
            try {
                const parent = await client.createMediaContainer({ mediaType: 'CAROUSEL', children: ids, caption: post.caption ?? undefined });
                await updateMediaPost(db, post.id, { creation_id: parent.id, phase: 'polling', error: null });
            }
            catch (error) {
                await mutationFailure(db, post, error, 'parent_creation_unconfirmed');
            }
            return;
        }
        if (!post.creation_id) {
            await updateMediaPost(db, post.id, { status: 'failed', error: 'processing post without creation_id' });
            return;
        }
        const status = await client.getContainerStatus(post.creation_id);
        if (status.status_code === 'PUBLISHED') {
            await updateMediaPost(db, post.id, { status: 'published', phase: 'published', error: 'recovered: container already PUBLISHED; media id unrecorded' });
            return;
        }
        if (phase === 'publishing') {
            if (post.phase_started_at && Date.parse(post.phase_started_at) < Date.now() - 5 * 60000)
                await updateMediaPost(db, post.id, { status: 'failed', phase: 'uncertain', error: 'publication_unconfirmed: inspect Instagram before retrying' });
            return;
        }
        if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
            await updateMediaPost(db, post.id, { status: 'failed', error: `container ${status.status_code}` });
            return;
        }
        if (status.status_code !== 'FINISHED' || !await claimPhase(db, post.id, phase, 'publishing'))
            return;
        try {
            const result = await client.publishMedia(post.creation_id);
            await updateMediaPost(db, post.id, { status: 'published', phase: 'published', published_media_id: result.id, error: null });
        }
        catch (error) {
            await mutationFailure(db, post, error, 'publication_unconfirmed');
        }
    }
    catch (error) {
        await recordReadFailure(db, post, error);
    }
}
async function mutationFailure(db: D1Database, post: MediaPost, error: unknown, reason: string): Promise<void> {
    const definite = error instanceof InstagramApiError && error.status < 500;
    await updateMediaPost(db, post.id, { status: 'failed', phase: definite ? 'rejected' : 'uncertain', attempt_count: post.attempt_count + 1, error: definite ? describeError(error) : `${reason}: inspect Instagram before creating another post` });
}
async function recordReadFailure(db: D1Database, post: MediaPost, error: unknown): Promise<void> {
    const attempts = post.attempt_count + 1;
    await updateMediaPost(db, post.id, { ...(attempts >= MAX_ATTEMPTS ? { status: 'failed' as const } : {}), attempt_count: attempts, error: describeError(error) });
}
function describeError(error: unknown): string {
    if (error instanceof InstagramApiError) {
        if (error.tokenExpired)
            return 'トークンが失効しています。設定から再接続してください（190）。';
        if ([10, 200].includes(error.code ?? -1))
            return '権限エラー: instagram_business_content_publish とアクセスレベルを確認してください。';
        return `Instagram API ${error.status}${error.code ? ` (code ${error.code})` : ''}`;
    }
    return 'Instagram APIの確認に失敗しました。接続状態を確認してください。';
}
