import type { InstagramClient } from '@ig-harness/ig-sdk';

// ── 配信ガードレール（U22 可視化・停止スイッチ）＋ 既読/入力中（U18） ──
// 設定は integration_settings のキー値ペアで持つ（migration 追加なし）。
// 既定値:
//   outbound_paused     = '0'（送信許可）
//   dm_presence_enabled = '0'（既読/入力中 OFF。野田さん未決のため既定OFF）

export const OUTBOUND_PAUSED_KEY = 'outbound_paused';
export const DM_PRESENCE_ENABLED_KEY = 'dm_presence_enabled';

/** 送信窓: step-delivery と同じ 9:00-23:00 JST。 */
export const DELIVERY_WINDOW_START_HOUR_JST = 9;
export const DELIVERY_WINDOW_END_HOUR_JST = 23;

export class OutboundPausedError extends Error {
  constructor() {
    super('Outbound sending is paused by the operator');
    this.name = 'OutboundPausedError';
  }
}

async function readSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM integration_settings WHERE key=?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSettingValue(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO integration_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=strftime(\'%Y-%m-%dT%H:%M:%SZ\',\'now\')')
    .bind(key, value).run();
}

export async function isOutboundPaused(db: D1Database): Promise<boolean> {
  return (await readSetting(db, OUTBOUND_PAUSED_KEY)) === '1';
}

export async function setOutboundPaused(db: D1Database, paused: boolean): Promise<void> {
  await setSettingValue(db, OUTBOUND_PAUSED_KEY, paused ? '1' : '0');
}

/** 既定は OFF（未設定='0'）。 */
export async function isDmPresenceEnabled(db: D1Database): Promise<boolean> {
  return (await readSetting(db, DM_PRESENCE_ENABLED_KEY)) === '1';
}

export async function setDmPresenceEnabled(db: D1Database, enabled: boolean): Promise<void> {
  await setSettingValue(db, DM_PRESENCE_ENABLED_KEY, enabled ? '1' : '0');
}

/** 送信窓内かどうか。step-delivery の processSingleDelivery と同じ JST 9-23 判定。 */
export function isWithinDeliveryWindow(now = Date.now()): boolean {
  const hour = new Date(now + 9 * 60 * 60_000).getUTCHours();
  return hour >= DELIVERY_WINDOW_START_HOUR_JST && hour < DELIVERY_WINDOW_END_HOUR_JST;
}

/**
 * Stop switch check. Throws OutboundPausedError so callers can treat a
 * paused state uniformly. Immediate webhook paths catch it and skip the
 * send; batch processors skip their whole drain instead (pending rows
 * stay pending and resume after unpausing).
 */
export async function assertOutboundAllowed(db: D1Database): Promise<void> {
  if (await isOutboundPaused(db)) throw new OutboundPausedError();
}

/** 文字数に応じた「入力中」表示時間。短文でも最小 600ms、長文でも上限 3s。 */
export function typingDelayMs(text: string | null | undefined): number {
  const length = (text ?? '').length;
  return Math.min(3000, Math.max(600, 400 + 60 * Math.min(length, 60)));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 既読 → 入力中 → 送信 の一連処理。設定 OFF のときは送信のみ。
 * 入力中表示は送信の成否に関係なく typing_off で必ず解除する。
 */
export async function sendWithPresence<T>(
  db: D1Database,
  client: InstagramClient,
  recipientId: string,
  send: () => Promise<T>,
  textForDelay?: string | null,
): Promise<T> {
  if (!await isDmPresenceEnabled(db)) return await send();
  await client.sendSenderAction(recipientId, 'mark_seen');
  await client.sendSenderAction(recipientId, 'typing_on');
  try {
    await sleep(typingDelayMs(textForDelay));
    return await send();
  } finally {
    try { await client.sendSenderAction(recipientId, 'typing_off'); } catch { /* best-effort */ }
  }
}

/**
 * 全送信経路に既読/入力中を一括で効かせるためのクライアント装飾。
 * getAccountClient の返値を包む。recipient が igsid でない private reply
 * （comment_id 宛）は sender_action を送れないためスキップする。
 */
export function decorateWithPresence(db: D1Database, client: InstagramClient): InstagramClient {
  type SendFn = (...args: any[]) => Promise<unknown>;
  const wrap = (name: keyof InstagramClient, textArgIndex: number | null): void => {
    const method = client[name];
    if (typeof method !== 'function') return;
    const original = (method as unknown as SendFn).bind(client);
    (client as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      const recipientId = typeof args[0] === 'string' ? args[0] : '';
      // comment_id 宛の private reply には既読/入力中を出せない
      if (name === 'sendPrivateReply' || !recipientId) return await original(...args);
      return await sendWithPresence(db, client, recipientId, () => original(...args),
        textArgIndex !== null && typeof args[textArgIndex] === 'string' ? args[textArgIndex] as string : null);
    };
  };
  // (method, text 引数の位置)。sendQuickReply は (recipientId, text, ...)
  wrap('sendText', 1);
  wrap('sendImage', null);
  wrap('sendGenericTemplate', null);
  wrap('sendQuickReply', 1);
  wrap('sendRichMessage', null);
  return client;
}

/** ガードレールの状態スナップショット（画面表示用）。認証情報は含まない。 */
export async function guardrailSnapshot(db: D1Database, accountId: string | null, now = Date.now()): Promise<{
  paused: boolean;
  presenceEnabled: boolean;
  window: { startHourJst: number; endHourJst: number; within: boolean; nowJst: string };
  followers: { eligible: number; windowExpired: number; standby: number };
  volume: { dmOut24h: number; pendingBroadcastRecipients: number; pendingCommentJobs: number; activeScenarios: number };
}> {
  const followers = await db.prepare(`
    SELECT
      COALESCE(SUM(messaging_owner='primary' AND last_inbound_at IS NOT NULL AND julianday(last_inbound_at)>julianday('now','-1 day')),0) AS eligible,
      COALESCE(SUM(messaging_owner='standby'),0) AS standby,
      COUNT(*) AS total
    FROM followers${accountId ? ' WHERE account_id=?' : ''}`)
    .bind(...(accountId ? [accountId] : [])).all<{ eligible: number; standby: number; total: number }>();
  const agg = followers.results[0] ?? { eligible: 0, standby: 0, total: 0 };
  const volume = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages_log WHERE direction='out' AND julianday(created_at)>julianday('now','-1 day')) AS dmOut24h,
      (SELECT COUNT(*) FROM broadcast_recipients WHERE status IN ('pending','processing')) AS pendingBroadcastRecipients,
      (SELECT COUNT(*) FROM comment_rule_jobs WHERE status='pending') AS pendingCommentJobs,
      (SELECT COUNT(*) FROM follower_scenarios WHERE status='active') AS activeScenarios`)
    .all<{ dmOut24h: number; pendingBroadcastRecipients: number; pendingCommentJobs: number; activeScenarios: number }>();
  const counts = volume.results[0] ?? { dmOut24h: 0, pendingBroadcastRecipients: 0, pendingCommentJobs: 0, activeScenarios: 0 };
  return {
    paused: await isOutboundPaused(db),
    presenceEnabled: await isDmPresenceEnabled(db),
    window: {
      startHourJst: DELIVERY_WINDOW_START_HOUR_JST,
      endHourJst: DELIVERY_WINDOW_END_HOUR_JST,
      within: isWithinDeliveryWindow(now),
      nowJst: new Date(now).toISOString(),
    },
    followers: {
      eligible: Number(agg.eligible) || 0,
      windowExpired: Math.max(0, Number(agg.total) - Number(agg.eligible) - Number(agg.standby)) || 0,
      standby: Number(agg.standby) || 0,
    },
    volume: {
      dmOut24h: Number(counts.dmOut24h) || 0,
      pendingBroadcastRecipients: Number(counts.pendingBroadcastRecipients) || 0,
      pendingCommentJobs: Number(counts.pendingCommentJobs) || 0,
      activeScenarios: Number(counts.activeScenarios) || 0,
    },
  };
}
