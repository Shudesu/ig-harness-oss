import {
  getDueMediaPosts,
  getProcessingMediaPosts,
  getMediaPostById,
  updateMediaPost,
  type MediaPost,
  type MediaPostMediaItem,
} from '@ig-harness/db';
import { jstNow } from '@ig-harness/db';
import type { InstagramClient } from '@ig-harness/ig-sdk';

const MAX_ATTEMPTS = 3;
const DEFAULT_QUOTA_TOTAL = 100;

/**
 * Cron entry — advances every media post of one account through the
 * state machine: scheduled → processing → published / failed.
 * Called every 5 minutes from the scheduled() handler.
 * `now` must be a JST (+09:00) string — scheduled_at comparison is a
 * plain SQL string compare, so formats must match (see Task 1 note).
 */
export async function processMediaPosts(
  db: D1Database,
  igClient: InstagramClient,
  accountId: string,
  now: string = jstNow(),
): Promise<void> {
  const due = await getDueMediaPosts(db, accountId, now);
  for (const post of due) {
    await startPost(db, igClient, post);
  }
  const processing = await getProcessingMediaPosts(db, accountId);
  for (const post of processing) {
    await advancePost(db, igClient, post);
  }
}

/**
 * Immediate-post fast path: run one start+advance cycle right away (via
 * waitUntil from the route). Images publish in seconds; videos fall back
 * to the next cron cycle while Meta processes the container.
 */
export async function kickImmediate(
  db: D1Database,
  igClient: InstagramClient,
  postId: string,
): Promise<void> {
  const post = await getMediaPostById(db, postId);
  if (!post || post.status !== 'scheduled') return;
  const started = await startPost(db, igClient, post);
  if (!started) return;
  const refreshed = await getMediaPostById(db, postId);
  if (refreshed && refreshed.status === 'processing') {
    await advancePost(db, igClient, refreshed);
  }
}

/** scheduled → processing (creates the IG container). Returns true on success. */
async function startPost(
  db: D1Database,
  igClient: InstagramClient,
  post: MediaPost,
): Promise<boolean> {
  try {
    const limit = await igClient.getPublishingLimit();
    const total = limit.config?.quota_total ?? DEFAULT_QUOTA_TOTAL;
    if (limit.quota_usage >= total) {
      // Not a failure — quota is a rolling 24h window, so carry the post
      // over to the next cycle without touching status/attempt_count.
      await updateMediaPost(db, post.id, {
        error: `publishing quota exhausted (${limit.quota_usage}/${total}); will retry next cycle`,
      });
      return false;
    }

    const media = JSON.parse(post.media) as MediaPostMediaItem[];
    let creationId: string;
    let childIds: string[] | null = null;

    if (post.post_type === 'carousel') {
      childIds = [];
      for (const item of media) {
        const child = await igClient.createMediaContainer({
          imageUrl: item.type === 'image' ? item.url : undefined,
          videoUrl: item.type === 'video' ? item.url : undefined,
          // Video carousel children require media_type=VIDEO.
          mediaType: item.type === 'video' ? 'VIDEO' : undefined,
          isCarouselItem: true,
        });
        childIds.push(child.id);
      }
      const parent = await igClient.createMediaContainer({
        mediaType: 'CAROUSEL',
        children: childIds,
        caption: post.caption ?? undefined,
      });
      creationId = parent.id;
    } else if (post.post_type === 'reel') {
      const created = await igClient.createMediaContainer({
        videoUrl: media[0].url,
        mediaType: 'REELS',
        caption: post.caption ?? undefined,
      });
      creationId = created.id;
    } else if (post.post_type === 'story') {
      const item = media[0];
      const created = await igClient.createMediaContainer({
        imageUrl: item.type === 'image' ? item.url : undefined,
        videoUrl: item.type === 'video' ? item.url : undefined,
        mediaType: 'STORIES',
      });
      creationId = created.id;
    } else {
      const created = await igClient.createMediaContainer({
        imageUrl: media[0].url,
        caption: post.caption ?? undefined,
      });
      creationId = created.id;
    }

    await updateMediaPost(db, post.id, {
      status: 'processing',
      creation_id: creationId,
      child_creation_ids: childIds ? JSON.stringify(childIds) : undefined,
      error: null,
    });
    return true;
  } catch (err) {
    await recordFailure(db, post, err);
    return false;
  }
}

/** processing → published / failed (polls container status, then publishes). */
async function advancePost(
  db: D1Database,
  igClient: InstagramClient,
  post: MediaPost,
): Promise<void> {
  if (!post.creation_id) {
    await updateMediaPost(db, post.id, { status: 'failed', error: 'processing post without creation_id' });
    return;
  }
  try {
    const status = await igClient.getContainerStatus(post.creation_id);
    if (status.status_code === 'FINISHED') {
      const result = await igClient.publishMedia(post.creation_id);
      await updateMediaPost(db, post.id, {
        status: 'published',
        published_media_id: result.id,
        error: null,
      });
    } else if (status.status_code === 'PUBLISHED') {
      // Container was already published (e.g., if the previous updateMediaPost write
      // failed or the worker was terminated after publishMedia succeeded). Recover
      // to published state without re-publishing.
      await updateMediaPost(db, post.id, {
        status: 'published',
        error: 'recovered: container already PUBLISHED; media id unrecorded',
      });
    } else if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      await updateMediaPost(db, post.id, {
        status: 'failed',
        error: `container ${status.status_code}: ${status.status ?? ''}`.trim(),
      });
    }
    // IN_PROGRESS → leave for the next cron cycle (video encoding takes minutes).
  } catch (err) {
    await recordFailure(db, post, err);
  }
}

/**
 * Transient errors bump attempt_count and retry next cycle; the 3rd
 * failure is terminal. Permission errors get an actionable message.
 */
async function recordFailure(db: D1Database, post: MediaPost, err: unknown): Promise<void> {
  const attempts = post.attempt_count + 1;
  const message = describeError(err);
  if (attempts >= MAX_ATTEMPTS) {
    await updateMediaPost(db, post.id, { status: 'failed', attempt_count: attempts, error: message });
  } else {
    await updateMediaPost(db, post.id, { attempt_count: attempts, error: message });
  }
}

function describeError(err: unknown): string {
  const message = String(err instanceof Error ? err.message : err);
  if (/\(#10\)|permission|not authorized|oauth/i.test(message)) {
    return `権限エラー: トークンに instagram_business_content_publish スコープが必要です。設定画面からアカウントを再認可してください。 (${message})`;
  }
  return message;
}
