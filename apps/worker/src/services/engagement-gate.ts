import { listEngagementGates, createGateDelivery, updateGateDelivery, getGateDelivery, getEngagementGate } from '@ig-harness/db';
import type { EngagementGate, GateDelivery } from '@ig-harness/db';
import type { UserProfile } from '@ig-harness/ig-sdk';

interface IgClientLike {
  sendGenericTemplate(recipientId: string, elements: unknown[]): Promise<unknown>;
  sendQuickReply(recipientId: string, text: string, items: unknown[]): Promise<unknown>;
  sendText(recipientId: string, text: string): Promise<unknown>;
  getUserProfile(igsid: string): Promise<UserProfile>;
}

interface FollowerRef {
  id: number;
  igsid: string;
}

export async function triggerGateForComment(
  db: D1Database,
  igClient: IgClientLike,
  args: { postId: string; commentText: string; follower: FollowerRef },
): Promise<boolean> {
  const gates = await listEngagementGates(db, { activeOnly: true });
  for (const gate of gates) {
    if (gate.trigger_type !== 'comment_on_post') continue;
    if (gate.target_post_id && gate.target_post_id !== args.postId) continue;
    if (gate.trigger_keyword && !args.commentText.includes(gate.trigger_keyword)) continue;

    const delivery = await createGateDelivery(db, {
      gate_id: gate.id,
      follower_id: args.follower.id,
      igsid: args.follower.igsid,
    });

    // Idempotent: only send the CTA on the very first trigger. The
    // unique (gate_id, follower_id) constraint means a follower has
    // exactly one delivery per gate; any subsequent comment/DM that
    // matches the same gate must NOT resend the CTA, regardless of
    // current status (cta_sent, pending_follow, delivered, dropped).
    if (delivery.status !== 'triggered') {
      return true;
    }

    await sendCtaDm(igClient, gate, delivery);
    await updateGateDelivery(db, delivery.id, { status: 'cta_sent' });
    return true; // Only one gate per comment
  }
  return false;
}

export async function triggerGateForDmKeyword(
  db: D1Database,
  igClient: IgClientLike,
  args: { text: string; follower: FollowerRef },
): Promise<boolean> {
  const gates = await listEngagementGates(db, { activeOnly: true });
  for (const gate of gates) {
    if (gate.trigger_type !== 'dm_keyword') continue;
    if (!gate.trigger_keyword || !args.text.includes(gate.trigger_keyword)) continue;

    const delivery = await createGateDelivery(db, {
      gate_id: gate.id,
      follower_id: args.follower.id,
      igsid: args.follower.igsid,
    });

    // Idempotent: only send the CTA on the very first trigger.
    if (delivery.status !== 'triggered') {
      return true;
    }

    await sendCtaDm(igClient, gate, delivery);
    await updateGateDelivery(db, delivery.id, { status: 'cta_sent' });
    return true;
  }
  return false;
}

export async function triggerGateForStoryMention(
  db: D1Database,
  igClient: IgClientLike,
  args: { follower: FollowerRef },
): Promise<boolean> {
  const gates = await listEngagementGates(db, { activeOnly: true });
  for (const gate of gates) {
    if (gate.trigger_type !== 'story_mention') continue;

    const delivery = await createGateDelivery(db, {
      gate_id: gate.id,
      follower_id: args.follower.id,
      igsid: args.follower.igsid,
    });

    // Idempotent: only send the CTA on the very first trigger.
    if (delivery.status !== 'triggered') {
      return true;
    }

    await sendCtaDm(igClient, gate, delivery);
    await updateGateDelivery(db, delivery.id, { status: 'cta_sent' });
    return true;
  }
  return false;
}

async function sendCtaDm(
  igClient: IgClientLike,
  gate: EngagementGate,
  delivery: GateDelivery,
): Promise<void> {
  const payload = `CHECK_FOLLOW:${gate.id}:${delivery.id}`;
  await igClient.sendGenericTemplate(delivery.igsid, [
    {
      title: gate.initial_dm_text.slice(0, 80),
      subtitle: gate.initial_dm_text.length > 80 ? gate.initial_dm_text.slice(80, 200) : undefined,
      buttons: [
        { type: 'postback', title: gate.initial_dm_button_label, payload },
      ],
    },
  ]);
}

export async function handleFollowCheckPostback(
  db: D1Database,
  igClient: IgClientLike,
  args: { gateId: string; deliveryId: string; igsid: string },
): Promise<void> {
  const [gate, delivery] = await Promise.all([
    getEngagementGate(db, args.gateId),
    getGateDelivery(db, args.deliveryId),
  ]);
  if (!gate || !delivery) return;
  if (delivery.status === 'delivered' || delivery.status === 'dropped') return;
  // Honour the operator pause/archive switch even for already-issued CTAs.
  if (gate.status !== 'active') return;

  const now = new Date().toISOString();

  // Skip Graph API entirely when follow is not required so a transient
  // profile lookup failure can't block reward delivery.
  if (gate.require_follow === 0) {
    await deliverReward(db, igClient, gate, delivery);
    await updateGateDelivery(db, delivery.id, {
      status: 'delivered',
      delivered_at: now,
      last_check_at: now,
    });
    return;
  }

  // Realtime follow check (do NOT trust DB cache)
  const profile = await igClient.getUserProfile(args.igsid);
  const isFollowing = profile.is_user_follow_business === true;

  if (isFollowing) {
    await deliverReward(db, igClient, gate, delivery);
    await updateGateDelivery(db, delivery.id, {
      status: 'delivered',
      delivered_at: now,
      last_check_at: now,
    });
    return;
  }

  // Enforce max_loops if configured (0 = unlimited, ManyChat behaviour)
  const nextLoopCount = delivery.loop_count + 1;
  if (gate.max_loops > 0 && nextLoopCount > gate.max_loops) {
    await updateGateDelivery(db, delivery.id, {
      status: 'dropped',
      loop_count: nextLoopCount,
      last_check_at: now,
    });
    return;
  }

  // Send reminder + same button (loop)
  await sendReminderDm(igClient, gate, delivery);
  await updateGateDelivery(db, delivery.id, {
    status: 'pending_follow',
    loop_count: nextLoopCount,
    last_check_at: now,
  });
}

async function sendReminderDm(
  igClient: IgClientLike,
  gate: EngagementGate,
  delivery: GateDelivery,
): Promise<void> {
  const payload = `CHECK_FOLLOW:${gate.id}:${delivery.id}`;
  await igClient.sendGenericTemplate(delivery.igsid, [
    {
      title: gate.follow_reminder_dm_text.slice(0, 80),
      subtitle: gate.follow_reminder_dm_text.length > 80
        ? gate.follow_reminder_dm_text.slice(80, 200)
        : undefined,
      buttons: [
        { type: 'postback', title: gate.follow_reminder_button_label, payload },
      ],
    },
  ]);
}

function expandIgsidPlaceholder(template: string, igsid: string): string {
  // Support both {IGSID} and {{IGSID}} so the dashboard hint and the more
  // common Mustache-style placeholder both work.
  return template
    .replace(/\{\{\s*IGSID\s*\}\}/g, igsid)
    .replace(/\{\s*IGSID\s*\}/g, igsid);
}

async function deliverReward(
  _db: D1Database,
  igClient: IgClientLike,
  gate: EngagementGate,
  delivery: GateDelivery,
): Promise<void> {
  let text = expandIgsidPlaceholder(gate.reward_dm_text, delivery.igsid);
  if (gate.reward_url) {
    const expandedUrl = expandIgsidPlaceholder(gate.reward_url, delivery.igsid);
    text = `${text}\n\n${expandedUrl}`;
  }
  await igClient.sendText(delivery.igsid, text);
}
