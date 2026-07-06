import {
  getFriendScenariosDueForDelivery,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  getFriendById,
  jstNow,
} from '@ig-harness/db';
import type { InstagramClient } from '@ig-harness/ig-sdk';
import { jitterDeliveryTime, addJitter, sleep } from './stealth.js';
import { recordDmFailure } from '../lib/health.js';

/**
 * Replace template variables in message content.
 *
 * Supported variables:
 * - {{name}}       -> follower's display name or username
 * - {{username}}   -> follower's IG username
 * - {{friend_id}}  -> follower's internal ID
 */
export function expandVariables(
  content: string,
  friend: { id: string; display_name: string | null; username?: string | null },
): string {
  let result = content;
  result = result.replace(/\{\{name\}\}/g, friend.display_name || friend.username || '');
  result = result.replace(/\{\{username\}\}/g, (friend as unknown as Record<string, unknown>).username as string || '');
  result = result.replace(/\{\{friend_id\}\}/g, friend.id);
  return result;
}

/** Default delivery window: 9:00-23:00 JST. If outside, push to next 9:00 AM. */
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 23;

function enforceDeliveryWindow(date: Date, preferredHour?: number): Date {
  const hours = date.getUTCHours();
  const startHour = preferredHour ?? DEFAULT_START_HOUR;
  const endHour = DEFAULT_END_HOUR;

  if (hours >= startHour && hours < endHour) return date;

  const result = new Date(date);
  if (hours >= endHour) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  result.setUTCHours(startHour, 0, 0, 0);
  return result;
}

export async function processStepDeliveries(
  db: D1Database,
  igClient: InstagramClient,
  workerUrl?: string,
  accountId?: string,
): Promise<void> {
  // Skip delivery outside 9:00-23:00 JST window
  const jstHour = new Date(Date.now() + 9 * 60 * 60_000).getUTCHours();
  if (jstHour < DEFAULT_START_HOUR || jstHour >= DEFAULT_END_HOUR) return;

  const now = jstNow();
  const dueFriendScenarios = await getFriendScenariosDueForDelivery(db, now, accountId);

  for (let i = 0; i < dueFriendScenarios.length; i++) {
    const fs = dueFriendScenarios[i];
    try {
      // Add small random delay between deliveries to avoid burst patterns
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }
      await processSingleDelivery(db, igClient, fs, workerUrl);
    } catch (err) {
      console.error(`Error processing friend_scenario ${fs.id}:`, err);
      await recordDmFailure(db, accountId ?? 'unknown').catch(() => {});
    }
  }
}

async function processSingleDelivery(
  db: D1Database,
  igClient: InstagramClient,
  fs: {
    id: string;
    follower_id: string;
    scenario_id: string;
    current_step: number;
    status: string;
    next_step_at: string | null;
  },
  _workerUrl?: string,
): Promise<void> {
  const friend = await getFriendById(db, fs.follower_id);
  if (!friend) {
    await completeFriendScenario(db, fs.id);
    return;
  }
  const metadata = JSON.parse((friend as { metadata?: string }).metadata || '{}') as Record<string, unknown>;
  const preferredHour = typeof metadata.preferred_hour === 'number' ? metadata.preferred_hour : undefined;

  const steps = await getScenarioSteps(db, fs.scenario_id);
  if (steps.length === 0) {
    await completeFriendScenario(db, fs.id);
    return;
  }

  // Find the next step whose step_order > current_step
  const currentStep = steps.find((s) => s.step_order > fs.current_step);
  if (!currentStep) {
    await completeFriendScenario(db, fs.id);
    return;
  }

  // Check step condition before sending
  if (currentStep.condition_type) {
    const conditionMet = await evaluateCondition(db, fs.follower_id, currentStep);
    if (!conditionMet) {
      if (currentStep.next_step_on_false !== null && currentStep.next_step_on_false !== undefined) {
        const jumpStep = steps.find((s) => s.step_order === currentStep.next_step_on_false);
        if (jumpStep) {
          const nextDate = new Date(Date.now() + 9 * 60 * 60_000);
          nextDate.setMinutes(nextDate.getMinutes() + jumpStep.delay_minutes);
          const windowedDate = enforceDeliveryWindow(nextDate, preferredHour);
          const jitteredDate = jitterDeliveryTime(windowedDate);
          await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
          return;
        }
      }
      const nextIndex = steps.indexOf(currentStep) + 1;
      if (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        const nextDate = new Date(Date.now() + 9 * 60 * 60_000);
        nextDate.setMinutes(nextDate.getMinutes() + nextStep.delay_minutes);
        const windowedDate = enforceDeliveryWindow(nextDate, preferredHour);
        const jitteredDate = jitterDeliveryTime(windowedDate);
        await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
      } else {
        await completeFriendScenario(db, fs.id);
      }
      return;
    }
  }

  // Expand template variables
  const expandedContent = expandVariables(currentStep.body, friend);
  // Send via Instagram Messaging API
  const igsid = friend.igsid;
  const parsed = JSON.parse(expandedContent);
  await sendIgMessage(igClient, igsid, currentStep.message_type, parsed);

  // Log outgoing message
  await db
    .prepare(
      `INSERT INTO messages_log (follower_id, direction, message_type, body, trigger_source)
       VALUES (?, 'out', ?, ?, 'scenario')`,
    )
    .bind(friend.id, currentStep.message_type, currentStep.body)
    .run();

  // Determine next step
  const currentIndex = steps.indexOf(currentStep);
  const nextStep = currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;

  if (nextStep) {
    const nextDeliveryDate = new Date(Date.now() + 9 * 60 * 60_000);
    nextDeliveryDate.setMinutes(nextDeliveryDate.getMinutes() + nextStep.delay_minutes);
    const windowedDate = enforceDeliveryWindow(nextDeliveryDate, preferredHour);
    const jitteredDate = jitterDeliveryTime(windowedDate);
    await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
  } else {
    await completeFriendScenario(db, fs.id);
  }
}

async function evaluateCondition(
  db: D1Database,
  friendId: string,
  step: { condition_type: string | null; condition_value: string | null },
): Promise<boolean> {
  if (!step.condition_type || !step.condition_value) return true;

  switch (step.condition_type) {
    case 'tag_exists': {
      const tag = await db
        .prepare('SELECT 1 FROM follower_tags WHERE follower_id = ? AND tag_id = ?')
        .bind(friendId, step.condition_value)
        .first();
      return !!tag;
    }
    case 'tag_not_exists': {
      const tag = await db
        .prepare('SELECT 1 FROM follower_tags WHERE follower_id = ? AND tag_id = ?')
        .bind(friendId, step.condition_value)
        .first();
      return !tag;
    }
    case 'metadata_equals': {
      const { key, value } = JSON.parse(step.condition_value) as { key: string; value: unknown };
      const friendRow = await db
        .prepare('SELECT metadata FROM followers WHERE id = ?')
        .bind(friendId)
        .first<{ metadata: string }>();
      const meta = JSON.parse(friendRow?.metadata || '{}') as Record<string, unknown>;
      return meta[key] === value;
    }
    case 'metadata_not_equals': {
      const { key, value } = JSON.parse(step.condition_value) as { key: string; value: unknown };
      const friendRow = await db
        .prepare('SELECT metadata FROM followers WHERE id = ?')
        .bind(friendId)
        .first<{ metadata: string }>();
      const meta = JSON.parse(friendRow?.metadata || '{}') as Record<string, unknown>;
      return meta[key] !== value;
    }
    case 'user_following': {
      const row = await db
        .prepare('SELECT is_following FROM followers WHERE id = ?')
        .bind(friendId)
        .first<{ is_following: number }>();
      return row?.is_following === 1;
    }
    case 'user_not_following': {
      const row = await db
        .prepare('SELECT is_following FROM followers WHERE id = ?')
        .bind(friendId)
        .first<{ is_following: number }>();
      return row?.is_following !== 1;
    }
    default:
      return true;
  }
}

/**
 * Send an IG message based on type.
 * body should be a parsed JSON object with type-specific fields.
 */
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

/**
 * Build an IG message payload (convenience wrapper for compatibility).
 */
export function buildIgMessage(messageType: string, messageContent: string): Record<string, unknown> {
  try {
    return JSON.parse(messageContent) as Record<string, unknown>;
  } catch {
    return { text: messageContent };
  }
}
