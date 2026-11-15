import { InstagramApiError, type InstagramClient } from '@ig-harness/ig-sdk';
import { describeFailure, failureHint } from './delivery-failures.js';

/** Fields IG Harness relies on (same list as the create-ig-harness installer). */
export const WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'messaging_referral', 'comments'] as const;

export type CheckState = 'ok' | 'missing' | 'error' | 'skipped';
export interface CheckResult { state: CheckState; message?: string | null }
export interface ConnectionReport {
  checkedAt: string;
  ok: boolean;
  profile: CheckResult & { username?: string | null };
  webhook: CheckResult & { fields: string[]; missingFields: string[]; subscribedNow: boolean };
  permissions: { comments: CheckResult; messages: CheckResult };
}

type ConnectionClient = Pick<InstagramClient, 'getMe' | 'subscribeApp' | 'getSubscribedFields' | 'probeConversations' | 'probeMediaComments' | 'getMyMedia'>;

/** Permission-shaped Graph errors: (#10), (#3), (#200-299). */
function isPermissionError(error: unknown): boolean {
  return error instanceof InstagramApiError && (error.code === 10 || error.code === 3 || (error.code !== undefined && error.code >= 200 && error.code <= 299));
}

function failed(error: unknown): CheckResult {
  const detail = describeFailure(error);
  const hint = failureHint(detail.errorCode, detail.errorSubcode, detail.message);
  const code = detail.errorCode !== null ? `code ${detail.errorCode}: ` : '';
  return { state: isPermissionError(error) ? 'missing' : 'error', message: `${code}${detail.message ?? '不明なエラー'}${hint ? ` — ${hint}` : ''}` };
}

/**
 * Read-mostly connection check. Only `subscribe: true` mutates Meta state
 * (POST /{ig-user-id}/subscribed_apps), and only for this account.
 */
export async function checkAccountConnection(client: ConnectionClient, opts: { subscribe: boolean }): Promise<ConnectionReport> {
  const report: ConnectionReport = {
    checkedAt: new Date().toISOString(),
    ok: false,
    profile: { state: 'skipped' },
    webhook: { state: 'skipped', fields: [], missingFields: [...WEBHOOK_FIELDS], subscribedNow: false },
    permissions: { comments: { state: 'skipped' }, messages: { state: 'skipped' } },
  };
  try {
    const me = await client.getMe();
    report.profile = { state: 'ok', username: me.username ?? null };
  } catch (error) {
    report.profile = { ...failed(error) };
    if (error instanceof InstagramApiError && error.tokenExpired) return report;
  }

  let subscribeError: unknown;
  if (opts.subscribe) {
    try {
      const result = await client.subscribeApp(WEBHOOK_FIELDS);
      report.webhook.subscribedNow = result?.success === true;
    } catch (error) { subscribeError = error; }
  }
  try {
    const fields = await client.getSubscribedFields();
    const missing = WEBHOOK_FIELDS.filter((f) => !fields.includes(f));
    report.webhook = { ...report.webhook, fields, missingFields: missing, state: missing.length ? 'missing' : 'ok',
      message: missing.length ? `未購読: ${missing.join(', ')}${subscribeError ? `（購読の実行に失敗: ${failed(subscribeError).message}）` : ''}` : null };
  } catch (error) {
    report.webhook = { ...report.webhook, ...failed(subscribeError ?? error) };
  }

  try { await client.probeConversations(); report.permissions.messages = { state: 'ok' }; }
  catch (error) { report.permissions.messages = failed(error); }

  try {
    const media = await client.getMyMedia(1);
    if (!media[0]?.id) report.permissions.comments = { state: 'skipped', message: '投稿が無いためコメント権限を確認できません（投稿後に再チェックしてください）' };
    else { await client.probeMediaComments(media[0].id); report.permissions.comments = { state: 'ok' }; }
  } catch (error) { report.permissions.comments = failed(error); }

  report.ok = report.profile.state === 'ok' && report.webhook.state === 'ok' && report.permissions.messages.state === 'ok' && report.permissions.comments.state !== 'missing' && report.permissions.comments.state !== 'error';
  return report;
}

const key = (accountId: string) => `health:connection:${accountId}`;

export async function saveConnectionReport(db: D1Database, accountId: string, report: ConnectionReport): Promise<void> {
  await db.prepare(`INSERT INTO integration_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`)
    .bind(key(accountId), JSON.stringify(report)).run();
}

export async function loadConnectionReport(db: D1Database, accountId: string): Promise<ConnectionReport | null> {
  const row = await db.prepare('SELECT value FROM integration_settings WHERE key = ?').bind(key(accountId)).first<{ value: string }>();
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as ConnectionReport; } catch { return null; }
}

export function parseConnectionReport(value: string | undefined): ConnectionReport | null {
  if (!value) return null;
  try { return JSON.parse(value) as ConnectionReport; } catch { return null; }
}
