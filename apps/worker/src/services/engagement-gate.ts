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
): Promise<void> {
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

    await sendCtaDm(igClient, gate, delivery);
    await updateGateDelivery(db, delivery.id, { status: 'cta_sent' });
    return; // Only one gate per comment
  }
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

  // Realtime follow check (do NOT trust DB cache)
  const profile = await igClient.getUserProfile(args.igsid);
  const isFollowing = profile.is_user_follow_business === true;
  const now = new Date().toISOString();

  if (isFollowing || gate.require_follow === 0) {
    await deliverReward(db, igClient, gate, delivery);
    await updateGateDelivery(db, delivery.id, {
      status: 'delivered',
      delivered_at: now,
      last_check_at: now,
    });
    return;
  }

  // Send reminder + same button (loop)
  await sendReminderDm(igClient, gate, delivery);
  await updateGateDelivery(db, delivery.id, {
    status: 'pending_follow',
    loop_count: delivery.loop_count + 1,
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

async function deliverReward(
  _db: D1Database,
  igClient: IgClientLike,
  gate: EngagementGate,
  delivery: GateDelivery,
): Promise<void> {
  let text = gate.reward_dm_text;
  if (gate.reward_url) {
    text = `${text}\n\n${gate.reward_url}`;
  }
  await igClient.sendText(delivery.igsid, text);
}
