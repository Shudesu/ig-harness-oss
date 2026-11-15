// B-07: the common connection-health contract (PLAN.md 1-1/1-2).
//
// Every check returns a stable id, a status (ok|warn|fail|unknown|manual),
// a human summary, secret-free evidence, and a nextAction telling the owner
// exactly what to do next (auto | approve | handoff | human_console | human_auth).
// Results are persisted per account; ok↔fail transitions are recorded once
// so notifications do not repeat.
import type { CredentialEnv } from './credential-crypto.js';
import { signatureFailures1h, signatureSuccesses1h, signatureLastAt } from './health.js';
import { parseConnectionReport, loadConnectionReport, saveConnectionReport, type ConnectionReport } from './account-connection.js';
import { loadTokenDebug, type TokenDebugInfo } from './token-debug.js';
import { checkAppWebhook, type AppWebhookReport, APP_SUBSCRIPTION_FIELDS } from './app-webhook.js';
import { getDeliveryWindowJst } from './delivery-window.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown' | 'manual';
export type NextActionKind = 'auto' | 'approve' | 'handoff' | 'human_console' | 'human_auth';

export interface NextAction {
  kind: NextActionKind;
  label: string;
  tool?: string;
  args?: Record<string, unknown>;
  docs?: string;
}

export interface HealthCheck {
  id: string;
  status: CheckStatus;
  summary: string;
  evidence?: Record<string, unknown>;
  nextAction?: NextAction;
}

export interface ConnectionHealthReport {
  checkedAt: string;
  accountId: string;
  platform: 'instagram';
  overall: 'ok' | 'warn' | 'fail';
  checks: HealthCheck[];
  /** ok→fail / fail→ok transitions recorded by this run (ids). */
  transitions: string[];
}

export interface ConnectionHealthAccount {
  id: string;
  ig_user_id: string;
  username: string | null;
  is_active: number;
  is_default: number;
  app_secret: string | null;
  verify_token: string | null;
  connection_type?: string;
}

const CHECK_ID_WEBHOOK_FIELDS = APP_SUBSCRIPTION_FIELDS;

function action(kind: NextActionKind, label: string, extra: Partial<NextAction> = {}): NextAction {
  return { kind, label, ...extra };
}

/** Run all checks for one account. `live` re-runs the Graph-backed probes. */
export async function runConnectionHealth(
  db: D1Database,
  env: CredentialEnv & { IG_APP_ID?: string; IG_APP_SECRET?: string; IG_VERIFY_TOKEN?: string; IG_ACCESS_TOKEN?: string; WORKER_URL: string },
  account: ConnectionHealthAccount,
  opts: { live?: boolean } = {},
): Promise<ConnectionHealthReport> {
  const checkedAt = new Date().toISOString();
  const checks: HealthCheck[] = [];
  const accountId = account.id;

  // Load stored state in one query.
  const rows = await db.prepare(`SELECT key, value FROM integration_settings WHERE key LIKE 'health:%'`).all<{ key: string; value: string }>();
  const map = new Map((rows.results ?? []).map((r) => [r.key, r.value]));

  // ── ig.secrets.present ──
  const hasAppSecret = Boolean(account.app_secret) || Boolean(env.IG_APP_SECRET);
  const hasVerifyToken = Boolean(account.verify_token) || Boolean(env.IG_VERIFY_TOKEN);
  checks.push({
    id: 'ig.secrets.present',
    status: hasAppSecret ? 'ok' : 'fail',
    summary: hasAppSecret ? 'App Secret は登録されています' : 'App Secret が未登録のため、Webhook 署名を検証できません（全イベント拒否）',
    evidence: { hasAppSecret, hasVerifyToken },
    nextAction: hasAppSecret
      ? undefined
      : action('handoff', 'App Secret をアカウントに登録する', {
          tool: 'update_account_credentials',
          args: { accountId, fields: ['appSecret', 'verifyToken'] },
          docs: 'Meta アプリ > 設定 > ベーシック > app secret',
        }),
  });

  // ── ig.webhook.signature ──
  const failures1h = signatureFailures1h(map, accountId);
  const successes1h = signatureSuccesses1h(map, accountId);
  const lastSig = signatureLastAt(map, accountId);
  const sigFail = failures1h > 0 && successes1h === 0;
  checks.push({
    id: 'ig.webhook.signature',
    status: sigFail ? 'fail' : failures1h > 0 ? 'warn' : successes1h > 0 || lastSig ? 'ok' : 'unknown',
    summary: sigFail
      ? `直近60分の署名検証失敗 ${failures1h}件・成功 0件 — イベントは全て拒否されています`
      : failures1h > 0
        ? `直近60分の署名失敗 ${failures1h}件・成功 ${successes1h}件`
        : lastSig
          ? '署名検証は通っています'
          : '署名検証の実績がありません（Webhook がまだ届いていない可能性）',
    evidence: { failures1h, successes1h, lastAt: lastSig },
    nextAction: sigFail
      ? action('handoff', 'App Secret を登録・差し替える', {
          tool: 'update_account_credentials',
          args: { accountId, fields: ['appSecret'] },
          docs: 'Meta アプリ > 設定 > ベーシック > app secret',
        })
      : undefined,
  });

  // ── ig.token.valid (hourly /me probe result) ──
  let tokenValid: { ok?: boolean; checked_at?: string; reason?: string } | null = null;
  const validityRaw = map.get(`health:token_valid:${accountId}`);
  if (validityRaw) { try { tokenValid = JSON.parse(validityRaw); } catch { /* malformed */ } }
  checks.push({
    id: 'ig.token.valid',
    status: tokenValid === null ? 'unknown' : tokenValid.ok === false ? 'fail' : 'ok',
    summary: tokenValid === null
      ? 'トークンの疎通確認がまだありません'
      : tokenValid.ok === false
        ? `トークンが使えません（${tokenValid.reason === 'token_expired' ? '期限切れ/失効' : tokenValid.reason === 'account_id_mismatch' ? 'トークン所有者と ID の不一致' : 'API 不達'}）`
        : 'トークン疎通 OK',
    evidence: { checkedAt: tokenValid?.checked_at ?? null, reason: tokenValid?.reason ?? null },
    nextAction: tokenValid?.ok === false
      ? action('handoff', '新しいアクセストークンを登録する', {
          tool: 'update_account_credentials',
          args: { accountId, fields: ['accessToken'] },
        })
      : undefined,
  });

  // ── ig.token.expiry / ig.token.scopes (B-04 debug_token) ──
  const tokenDebug: TokenDebugInfo | null = map.get(`health:token_debug:${accountId}`)
    ? (JSON.parse(map.get(`health:token_debug:${accountId}`) ?? 'null') as TokenDebugInfo)
    : null;
  const realExpiry = tokenDebug?.status === 'ok' && typeof tokenDebug.expiresAt === 'number' && tokenDebug.expiresAt > 0 ? tokenDebug.expiresAt : null;
  const daysLeft = realExpiry !== null ? Math.floor((realExpiry * 1000 - Date.now()) / 86_400_000) : null;
  const expiryStatus: CheckStatus = tokenDebug === null
    ? 'unknown'
    : tokenDebug.status === 'unknown'
      ? 'unknown'
      : realExpiry === null
        ? 'ok'
        : daysLeft !== null && daysLeft <= 3
          ? 'fail'
          : daysLeft !== null && daysLeft <= 14
            ? 'warn'
            : 'ok';
  checks.push({
    id: 'ig.token.expiry',
    status: expiryStatus,
    summary: tokenDebug === null
      ? 'debug_token の結果がまだありません'
      : tokenDebug.status === 'unknown'
        ? 'debug_token を取得できませんでした（App Secret / IG_APP_ID を設定すると判定できます）'
        : realExpiry === null
          ? 'トークンは無期限です'
          : `トークンの有効期限は ${new Date(realExpiry * 1000).toLocaleDateString('ja-JP')}（あと${daysLeft}日）`,
    evidence: { expiresAt: realExpiry, dataAccessExpiresAt: tokenDebug?.dataAccessExpiresAt ?? null, appId: tokenDebug?.appId ?? null, checkedAt: tokenDebug?.checkedAt ?? null },
    nextAction: expiryStatus === 'fail' || expiryStatus === 'warn'
      ? action('human_auth', '期限が切れる前に再接続（またはシステムユーザートークンへ切替）する', {
          tool: 'update_account_credentials',
          args: { accountId, fields: ['accessToken'] },
        })
      : expiryStatus === 'unknown'
        ? action('handoff', 'App Secret を登録すると debug_token で期限を判定できます', {
            tool: 'update_account_credentials',
            args: { accountId, fields: ['appSecret'] },
          })
        : undefined,
  });

  const missingScopes = tokenDebug?.status === 'ok' ? tokenDebug.missingScopes ?? [] : [];
  checks.push({
    id: 'ig.token.scopes',
    status: tokenDebug?.status === 'ok' ? (missingScopes.length ? 'fail' : 'ok') : 'unknown',
    summary: tokenDebug?.status === 'ok'
      ? missingScopes.length ? `不足スコープ: ${missingScopes.join(', ')}` : '必須スコープは揃っています'
      : 'debug_token の結果がまだありません',
    evidence: { scopes: tokenDebug?.scopes ?? [], missingScopes },
    nextAction: missingScopes.length
      ? action('human_auth', '不足スコープを付けて再同意する', {
          tool: 'update_account_credentials',
          args: { accountId, fields: ['accessToken'] },
          docs: 'Meta アプリ > 権限 で該当 permission の Advanced Access も確認',
        })
      : undefined,
  });

  // ── ig.app.subscription (B-08; live only when requested) ──
  let appWebhook: AppWebhookReport;
  const stored = map.get(`health:app_webhook:${accountId}`);
  if (opts.live || !stored) {
    appWebhook = await checkAppWebhook(env, db, account);
    await db.prepare(
      `INSERT INTO integration_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
    ).bind(`health:app_webhook:${accountId}`, JSON.stringify(appWebhook)).run().catch(() => {});
  } else {
    try { appWebhook = JSON.parse(stored) as AppWebhookReport; } catch { appWebhook = await checkAppWebhook(env, db, account); }
  }
  checks.push({
    id: 'ig.app.subscription',
    status: appWebhook.status === 'unknown' ? 'unknown' : appWebhook.status === 'fail' ? 'fail' : 'ok',
    summary: appWebhook.status === 'unknown'
      ? appWebhook.message ?? 'アプリ側の Webhook 設定を読み取れませんでした'
      : appWebhook.status === 'fail'
        ? `アプリ側の Webhook 購読に問題: ${appWebhook.message}`
        : 'アプリ側の Webhook 購読は正しく設定されています',
    evidence: { callbackUrl: appWebhook.callbackUrl, missingFields: appWebhook.missingFields, objects: appWebhook.objects.map((o) => ({ object: o.object, fields: o.fields })) },
    nextAction: appWebhook.status === 'fail'
      ? appWebhook.callbackMatches === false && appWebhook.callbackUrl
        ? action('human_console', '別アプリの Webhook が設定されています。上書きはしないので Meta の App Dashboard で確認・修正してください', { docs: 'Meta アプリ > Webhooks > 設定' })
        : action('approve', 'この Worker の Webhook 購読を設定する', { tool: 'fix_app_webhook', args: { accountId } })
      : appWebhook.status === 'unknown'
        ? action('handoff', 'App Secret を登録するとアプリ側の購読を確認できます', {
            tool: 'update_account_credentials',
            args: { accountId, fields: ['appSecret'] },
          })
        : undefined,
  });

  // ── ig.account.subscribed_apps / ig.permissions (stored connection report) ──
  const connection: ConnectionReport | null = opts.live ? await loadConnectionReport(db, accountId) : parseConnectionReport(map.get(`health:connection:${accountId}`)) ?? null;
  checks.push({
    id: 'ig.account.subscribed_apps',
    status: !connection ? 'unknown' : connection.webhook.state === 'ok' ? 'ok' : connection.webhook.state === 'missing' ? 'fail' : 'unknown',
    summary: !connection
      ? 'アカウント側の購読チェックがまだありません（「接続チェック」を実行してください）'
      : connection.webhook.state === 'ok'
        ? `アカウント側の購読 OK（${connection.webhook.fields.join(', ')}）`
        : `アカウント側の購読に不足: ${connection.webhook.missingFields.join(', ')}`,
    evidence: { fields: connection?.webhook.fields ?? [], missingFields: connection?.webhook.missingFields ?? [] },
    nextAction: connection?.webhook.state === 'missing'
      ? action('approve', '購読し直す（subscribed_apps）', { tool: 'check_account_connection', args: { accountId, resubscribe: true, confirm: true } })
      : undefined,
  });
  const perms = connection?.permissions;
  const permStates = [perms?.messages?.state, perms?.comments?.state];
  checks.push({
    id: 'ig.permissions',
    status: !connection ? 'unknown' : permStates.every((s) => s === 'ok' || s === 'skipped') ? 'ok' : permStates.includes('missing') ? 'fail' : 'unknown',
    summary: !connection
      ? '権限チェックがまだありません'
      : permStates.every((s) => s === 'ok' || s === 'skipped')
        ? 'DM・コメント権限は確認できています'
        : `権限に問題: DM=${perms?.messages?.message ?? perms?.messages?.state ?? '-'} / コメント=${perms?.comments?.message ?? perms?.comments?.state ?? '-'}`,
    evidence: { messages: perms?.messages?.state ?? null, comments: perms?.comments?.state ?? null },
    nextAction: permStates.includes('missing')
      ? action('human_console', '該当 permission の承認状態を Meta アプリで確認する', { docs: 'Meta アプリ > App Review > Permissions and Features' })
      : undefined,
  });

  // ── ig.app.mode (manual) ──
  const manualRaw = map.get(`health:manual_check:ig.app.mode:${accountId}`);
  const manual = manualRaw ? (JSON.parse(manualRaw) as { confirmedAt: string }) : null;
  const noInboundHint = !lastSig && failures1h === 0 && successes1h === 0;
  checks.push({
    id: 'ig.app.mode',
    status: 'manual',
    summary: manual
      ? `ライブモード確認済み（${manual.confirmedAt.slice(0, 10)} 確認）`
      : noInboundHint
        ? 'アプリのモードは API から取得できません。購読・署名が OK なのに受信が無い場合、開発モードの疑いがあります'
        : 'アプリのモードは API から取得できません（確認済みなら記録できます）',
    evidence: { confirmedAt: manual?.confirmedAt ?? null },
    nextAction: action('human_console', manual ? 'Meta アプリ > ダッシュボード上部のトグルでライブモードを再確認する' : 'Meta アプリ > ダッシュボード上部のトグルでライブモードにする（確認後に confirm_manual_check で記録）', { docs: 'Meta アプリ > ダッシュボード > アプリモード' }),
  });

  // ── ig.webhook.freshness ──
  const lastWebhookAt = map.get(`health:last_webhook_at:${accountId}`) ?? null;
  const staleHours = lastWebhookAt ? Math.floor((Date.now() - Date.parse(lastWebhookAt)) / 3_600_000) : null;
  checks.push({
    id: 'ig.webhook.freshness',
    status: !lastWebhookAt ? 'unknown' : staleHours !== null && staleHours >= 48 ? 'warn' : 'ok',
    summary: !lastWebhookAt
      ? 'Webhook を一度も受信していません'
      : sigFail
        ? '受信はありますが署名で拒否されています'
        : `最終受信: ${lastWebhookAt}（${staleHours}時間前）`,
    evidence: { lastWebhookAt, failures1h },
    nextAction: !lastWebhookAt
      ? action('auto', 'アプリ側・アカウント側の購読と署名の上の項目を確認する')
      : undefined,
  });

  // ── ig.delivery.window (B-06: informational, correct scoping) ──
  const window = await getDeliveryWindowJst(db);
  const fullWindow = window.start === 0 && window.end === 24;
  checks.push({
    id: 'ig.delivery.window',
    status: 'ok',
    summary: fullWindow
      ? 'シナリオ配信の送信時間帯: 24時間（制限なし）。コメント DM と通常返信はもともと時間帯の制限なし'
      : `シナリオ配信の送信時間帯: ${window.start}〜${window.end}時（JST）。対象はシナリオ配信のみ。コメント DM と通常返信は時間帯の制限なし`,
    evidence: { startHourJst: window.start, endHourJst: window.end },
  });

  const overall: ConnectionHealthReport['overall'] = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn' || c.status === 'unknown')
      ? 'warn'
      : 'ok';

  // ── transition detection (ok→fail / fail→ok only) ──
  const transitions: string[] = [];
  const previous = map.get(`health:checks:${accountId}`);
  if (previous) {
    try {
      const prev = JSON.parse(previous) as ConnectionHealthReport;
      for (const check of checks) {
        const before = prev.checks.find((c) => c.id === check.id);
        if (!before) continue;
        const wasBad = before.status === 'fail';
        const isBad = check.status === 'fail';
        if (wasBad !== isBad) transitions.push(check.id);
      }
    } catch { /* malformed previous report */ }
  }
  await db.prepare(
    `INSERT INTO integration_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
  ).bind(`health:checks:${accountId}`, JSON.stringify({ checkedAt, accountId, platform: 'instagram', overall, checks })).run().catch(() => {});
  if (transitions.length) {
    await db.prepare(
      `INSERT INTO integration_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
    ).bind(`health:check_transitions:${accountId}`, JSON.stringify({ checkedAt, ids: transitions })).run().catch(() => {});
  }

  return { checkedAt, accountId, platform: 'instagram', overall, checks, transitions };
}

/** Load the last stored report without re-running probes. */
export async function loadConnectionHealth(db: D1Database, accountId: string): Promise<ConnectionHealthReport | null> {
  const row = await db.prepare('SELECT value FROM integration_settings WHERE key = ?').bind(`health:checks:${accountId}`).first<{ value: string }>();
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Omit<ConnectionHealthReport, 'transitions'>;
    const t = await db.prepare('SELECT value FROM integration_settings WHERE key = ?').bind(`health:check_transitions:${accountId}`).first<{ value: string }>();
    const transitions = t?.value ? (JSON.parse(t.value) as { ids?: string[] }).ids ?? [] : [];
    return { ...parsed, transitions };
  } catch { return null; }
}

export function summarizeNextActions(accounts: ConnectionHealthReport[]): Array<{ accountId: string; check: HealthCheck }> {
  const priority: Record<CheckStatus, number> = { fail: 0, warn: 1, unknown: 2, manual: 3, ok: 4 };
  const out: Array<{ accountId: string; check: HealthCheck }> = [];
  for (const report of accounts) {
    for (const check of report.checks) {
      if (check.status === 'ok') continue;
      out.push({ accountId: report.accountId, check });
    }
  }
  out.sort((a, b) => priority[a.check.status] - priority[b.check.status]);
  return out;
}

/** Standard webhook field ids are exposed for tests/tools. */
export const CONNECTION_HEALTH_WEBHOOK_FIELDS = CHECK_ID_WEBHOOK_FIELDS;
