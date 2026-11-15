// B-08/B-09: inspect and fix the *app-side* webhook subscription
// (GET/POST https://graph.facebook.com/{version}/{app-id}/subscriptions).
// The account-side subscribed_apps check lives in account-connection.ts —
// both sides must be configured before Meta delivers any event.
import type { CredentialEnv } from './credential-crypto.js';
import { readAppSecret } from './credential-crypto.js';
import { loadTokenDebug } from './token-debug.js';

/** Fields the app-side instagram (or page) object subscription should carry. */
export const APP_SUBSCRIPTION_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_referral',
  'comments',
  'mentions',
  'live_comments',
] as const;

const GRAPH_VERSION = 'v25.0';

/** The stored secret may be unreadable (wrong key); fall back to the env secret. */
async function resolveAppSecret(
  account: { id: string; ig_user_id: string; app_secret: string | null },
  env: CredentialEnv & { IG_APP_SECRET?: string },
): Promise<string | undefined> {
  try {
    return (await readAppSecret(account, env)) ?? env.IG_APP_SECRET ?? undefined;
  } catch {
    return env.IG_APP_SECRET ?? undefined;
  }
}

export interface AppSubscriptionObject {
  object: string;
  callbackUrl: string | null;
  fields: string[];
  active: boolean;
}

export interface AppWebhookReport {
  checkedAt: string;
  status: 'ok' | 'fail' | 'unknown';
  appId: string | null;
  callbackUrl: string | null;
  objects: AppSubscriptionObject[];
  missingFields: string[];
  callbackMatches: boolean | null;
  message?: string | null;
}

function appAccessToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

/**
 * Resolve the Meta app id: explicit IG_APP_ID env, else the app_id learned
 * from debug_token (B-04). Returns null when neither is available.
 */
export async function resolveAppId(
  env: CredentialEnv & { IG_APP_ID?: string; IG_APP_SECRET?: string },
  db: D1Database,
  accountId: string,
): Promise<string | null> {
  if (env.IG_APP_ID) return env.IG_APP_ID;
  const debug = await loadTokenDebug(db, accountId);
  return debug?.status === 'ok' ? debug.appId ?? null : null;
}

async function fetchSubscriptions(
  appId: string,
  appSecret: string,
): Promise<{ objects: AppSubscriptionObject[]; raw: unknown }> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions`);
  url.searchParams.set('access_token', appAccessToken(appId, appSecret));
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const payload = (await res.json().catch(() => ({}))) as {
    data?: Array<{ object?: string; callback_url?: string; fields?: Array<{ name: string }> }>;
    error?: { code?: number; message?: string };
  };
  if (!res.ok || payload.error) {
    const error = new Error(payload.error?.message ?? `subscriptions read failed (HTTP ${res.status})`);
    (error as Error & { graphCode?: number }).graphCode = payload.error?.code;
    throw error;
  }
  const objects = (payload.data ?? []).map((row) => ({
    object: row.object ?? '',
    callbackUrl: row.callback_url ?? null,
    fields: (row.fields ?? []).map((f) => f.name),
    active: true,
  }));
  return { objects, raw: payload };
}

/**
 * Read-only app-side subscription check. Unknown (not fail) when the app id
 * or secret is missing, or Meta refuses the read (insufficient app role /
 * token type — 要実機).
 */
export async function checkAppWebhook(
  env: CredentialEnv & { IG_APP_ID?: string; IG_APP_SECRET?: string; WORKER_URL: string },
  db: D1Database,
  account: { id: string; ig_user_id: string; app_secret: string | null },
): Promise<AppWebhookReport> {
  const checkedAt = new Date().toISOString();
  const expectedCallback = `${env.WORKER_URL.replace(/\/$/, '')}/webhook`;
  const appId = await resolveAppId(env, db, account.id);
  const appSecret = await resolveAppSecret(account, env);
  if (!appId || !appSecret) {
    return {
      checkedAt, status: 'unknown', appId, callbackUrl: null, objects: [], missingFields: [], callbackMatches: null,
      message: 'App ID / App Secret が無いため、アプリ側の Webhook 設定を読み取れません。App Secret を登録し（必要なら IG_APP_ID も設定し）、再チェックしてください。',
    };
  }
  try {
    const { objects } = await fetchSubscriptions(appId, appSecret);
    // Page-linked Unified login receives comments via the app-level instagram
    // object subscription; both instagram and page objects are inspected.
    const relevant = objects.filter((o) => o.object === 'instagram' || o.object === 'page');
    const fields = new Set(relevant.flatMap((o) => o.fields));
    const missingFields = APP_SUBSCRIPTION_FIELDS.filter((f) => !fields.has(f));
    const callbackMatches = relevant.length > 0 && relevant.every((o) => o.callbackUrl === expectedCallback);
    const status: AppWebhookReport['status'] = relevant.length === 0 || !callbackMatches || missingFields.length > 0 ? 'fail' : 'ok';
    return {
      checkedAt,
      status,
      appId,
      callbackUrl: relevant[0]?.callbackUrl ?? null,
      objects,
      missingFields,
      callbackMatches,
      message: status === 'ok' ? null : [
        relevant.length === 0 ? 'アプリ側の Webhook 購読がありません' : null,
        callbackMatches === false ? 'コールバック URL がこの Worker と一致しません' : null,
        missingFields.length ? `未購読フィールド: ${missingFields.join(', ')}` : null,
      ].filter(Boolean).join(' / '),
    };
  } catch (error) {
    return {
      checkedAt, status: 'unknown', appId, callbackUrl: null, objects: [], missingFields: [], callbackMatches: null,
      message: `アプリ側購読を読み取れませんでした（${error instanceof Error ? error.message : 'unknown error'}）`,
    };
  }
}

export interface FixAppWebhookResult {
  fixed: boolean;
  refused?: boolean;
  foreignUrl?: string;
  verifyTokenGenerated?: boolean;
  report: AppWebhookReport;
}

/**
 * B-09: repair the app-side subscription with an approval. Generates a fresh
 * verify token (saved on the account) so nobody has to keep a copy of the old
 * one. A foreign callback URL is never overwritten — the operator must fix
 * that in the App Dashboard (human_console).
 */
export async function fixAppWebhook(
  env: CredentialEnv & { IG_APP_ID?: string; IG_APP_SECRET?: string; WORKER_URL: string },
  db: D1Database,
  account: { id: string; ig_user_id: string; app_secret: string | null },
  opts: { updateAccountVerifyToken: (verifyToken: string) => Promise<void> },
): Promise<FixAppWebhookResult> {
  const expectedCallback = `${env.WORKER_URL.replace(/\/$/, '')}/webhook`;
  const appId = await resolveAppId(env, db, account.id);
  const appSecret = await resolveAppSecret(account, env);
  const reportBefore = await checkAppWebhook(env, db, account);
  if (!appId || !appSecret) {
    return { fixed: false, report: reportBefore };
  }
  if (reportBefore.status === 'unknown') {
    return { fixed: false, report: reportBefore };
  }
  let foreignUrl: string | null = null;
  for (const o of reportBefore.objects) {
    if ((o.object === 'instagram' || o.object === 'page') && o.callbackUrl && o.callbackUrl !== expectedCallback) {
      foreignUrl = o.callbackUrl;
      break;
    }
  }
  if (foreignUrl) {
    return { fixed: false, refused: true, foreignUrl, report: reportBefore };
  }

  const verifyToken = generateVerifyToken();
  await opts.updateAccountVerifyToken(verifyToken);

  const objects = new Set(reportBefore.objects.filter((o) => o.object === 'instagram' || o.object === 'page').map((o) => o.object));
  if (!objects.size) objects.add('instagram');
  let lastError: unknown;
  for (const object of objects) {
    const existing = reportBefore.objects.filter((o) => o.object === object).flatMap((o) => o.fields);
    const fields = [...new Set([...APP_SUBSCRIPTION_FIELDS, ...existing])];
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: appAccessToken(appId, appSecret), object, callback_url: expectedCallback, verify_token: verifyToken, fields: fields.join(',') }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    if (!res.ok || payload.error) lastError = new Error(payload.error?.message ?? `subscription write failed (HTTP ${res.status})`);
  }
  if (lastError) {
    return {
      fixed: false,
      report: { ...reportBefore, status: 'unknown', message: `アプリ側購読の設定に失敗しました: ${lastError instanceof Error ? lastError.message : 'unknown error'}` },
    };
  }
  const report = await checkAppWebhook(env, db, account);
  await db.prepare(
    `INSERT INTO integration_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
  ).bind(`health:app_webhook:${account.id}`, JSON.stringify(report)).run().catch(() => {});
  return { fixed: true, verifyTokenGenerated: true, report };
}

function generateVerifyToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
