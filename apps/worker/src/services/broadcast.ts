import {
  getBroadcastById,
  getBroadcasts,
  updateBroadcastStatus,
  getFriendsByTag,
  jstNow,
} from '@ig-harness/db';
import type { Broadcast } from '@ig-harness/db';
import type { InstagramClient } from '@ig-harness/ig-sdk';
import { calculateStaggerDelay, sleep } from './stealth.js';

const BATCH_SIZE = 50; // IG API is more conservative than LINE

export async function processBroadcastSend(
  db: D1Database,
  igClient: InstagramClient,
  broadcastId: number | string,
  _workerUrl?: string,
): Promise<Broadcast> {
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  const messageBody = JSON.parse(broadcast.body) as Record<string, unknown>;
  let totalSent = 0;

  try {
    if (!broadcast.tag_filter) {
      // No tag filter — send to all followers
      const followers = await db
        .prepare(`SELECT id, igsid FROM followers`)
        .all<{ id: number; igsid: string }>();
      const allFollowers = followers.results;

      for (let i = 0; i < allFollowers.length; i += BATCH_SIZE) {
        const batch = allFollowers.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE);

        if (batchIndex > 0) {
          const delay = calculateStaggerDelay(allFollowers.length, batchIndex);
          await sleep(delay);
        }

        for (const follower of batch) {
          try {
            await sendIgMessage(igClient, follower.igsid, broadcast.message_type, messageBody);
            totalSent++;

            await db
              .prepare(
                `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
                 VALUES (?, 'out', ?, ?, 'broadcast')`,
              )
              .bind(follower.id, broadcast.message_type, broadcast.body)
              .run();
          } catch (err) {
            console.error(`Broadcast send failed for follower ${follower.id}:`, err);
          }
        }
      }
    } else {
      // tag_filter present — parse and send to matching followers
      const tagFilter = JSON.parse(broadcast.tag_filter) as { tagId?: string };
      if (!tagFilter.tagId) {
        throw new Error('tag_filter must contain tagId');
      }

      const friends = await getFriendsByTag(db, tagFilter.tagId);

      for (let i = 0; i < friends.length; i += BATCH_SIZE) {
        const batch = friends.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE);

        if (batchIndex > 0) {
          const delay = calculateStaggerDelay(friends.length, batchIndex);
          await sleep(delay);
        }

        for (const friend of batch) {
          try {
            await sendIgMessage(igClient, friend.igsid, broadcast.message_type, messageBody);
            totalSent++;

            await db
              .prepare(
                `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
                 VALUES (?, 'out', ?, ?, 'broadcast')`,
              )
              .bind(friend.id, broadcast.message_type, broadcast.body)
              .run();
          } catch (err) {
            console.error(`Broadcast send failed for friend ${friend.id}:`, err);
          }
        }
      }
    }

    await updateBroadcastStatus(db, broadcastId, 'sent', { totalSent });
  } catch (err) {
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

export async function processScheduledBroadcasts(
  db: D1Database,
  igClient: InstagramClient,
  workerUrl?: string,
): Promise<void> {
  const allBroadcasts = await getBroadcasts(db);
  const nowMs = Date.now();

  const scheduled = allBroadcasts.filter(
    (b) =>
      b.status === 'scheduled' &&
      b.scheduled_at !== null &&
      new Date(b.scheduled_at).getTime() <= nowMs,
  );

  for (const broadcast of scheduled) {
    try {
      await processBroadcastSend(db, igClient, broadcast.id, workerUrl);
    } catch (err) {
      console.error(`Failed to send scheduled broadcast ${broadcast.id}:`, err);
    }
  }
}

async function sendIgMessage(
  igClient: InstagramClient,
  recipientId: string,
  messageType: string,
  body: Record<string, unknown>,
): Promise<void> {
  switch (messageType) {
    case 'text':
      await igClient.sendText(recipientId, body.text as string);
      break;
    case 'image':
      await igClient.sendImage(recipientId, body.url as string);
      break;
    case 'template':
      await igClient.sendGenericTemplate(recipientId, body.elements as never[]);
      break;
    case 'quick_reply':
      await igClient.sendQuickReply(
        recipientId,
        body.text as string,
        body.quick_replies as never[],
      );
      break;
    default:
      if (typeof body.text === 'string') {
        await igClient.sendText(recipientId, body.text);
      }
  }
}
