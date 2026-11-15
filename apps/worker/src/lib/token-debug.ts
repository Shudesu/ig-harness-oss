// B-04: real token inspection via GET /debug_token.
//
// The stored token_expires_at only exists for Instagram Login tokens that
// went through refresh; Unified login (EAA) tokens previously showed the
// fixed "自動更新なし" label because the expiry was never fetched. This
// module asks Meta for the truth: validity, expiry, data-access expiry,
// scopes and the owning app id.
import { readAppSecret, type CredentialEnv } from './credential-crypto.js';

/** Scopes the harness needs, per connection type. Missing ones are surfaced by name. */
export const IG_REQUIRED_SCOPES: Record<'instagram_login' | 'facebook_login', string[]> = {
  instagram_login: [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
  ],
  // Unified login: comment/DM work happens through the Instagram product on a
  // Facebook app; messaging needs pages_messaging, comments need
  // instagram_manage_comments.
  facebook_login: [
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'instagram_content_publish',
    'pages_messaging',
    'pages_show_list',
    'business_management',
  ],
};

export interface TokenDebugInfo {
  checkedAt: string;
  /** ok = Meta answered with a debug payload; unknown = could not determine (not fail). */
  status: 'ok' | 'unknown';
  isValid?: boolean | null;
  appId?: string | null;
  /** Seconds since epoch; 0 = never expires (system user token). */
  expiresAt?: number | null;
  dataAccessExpiresAt?: number | null;
  scopes?: string[];
  missingScopes?: string[];
  error?: string;
}

interface DebugTokenResponse {
  data?: {
    is_valid?: boolean;
    app_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: Array<{ scope: string }>;
    error?: { code?: number; message?: string };
  };
  error?: { code?: number; message?: string };
}

const GRAPH_VERSION = 'v25.0';

/**
 * Call GET /debug_token for the account's token. The access_token parameter
 * candidates, in order:
 *  1. `{IG_APP_ID}|{appSecret}` — the proper app access token (IG_APP_ID optional env)
 *  2. the account's own token (+ appsecret_proof) — works when the caller is
 *     a developer/admin of the app (typical for self-hosted owners).
 */
export async function debugAccountToken(
  env: CredentialEnv & { IG_APP_ID?: string; IG_APP_SECRET?: string },
  account: { id: string; ig_user_id: string; access_token: string; app_secret: string | null },
  appSecretOverride?: string | null,
): Promise<TokenDebugInfo> {
  const checkedAt = new Date().toISOString();
  const appSecret = appSecretOverride ?? (await readAppSecret(account, env)) ?? env.IG_APP_SECRET;
  const candidates: Array<{ token: string; proof?: string }> = [];
  if (env.IG_APP_ID && appSecret) candidates.push({ token: `${env.IG_APP_ID}|${appSecret}` });
  if (account.access_token && appSecret) {
    // appsecret_proof = HMAC-SHA256(token, appSecret), hex.
    const proof = await appSecretProof(account.access_token, appSecret);
    candidates.push({ token: account.access_token, proof });
  }

  let lastError = '';
  for (const candidate of candidates) {
    try {
      const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`);
      url.searchParams.set('input_token', account.access_token);
      url.searchParams.set('access_token', candidate.token);
      if (candidate.proof) url.searchParams.set('appsecret_proof', candidate.proof);
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const payload = (await res.json().catch(() => ({}))) as DebugTokenResponse;
      if (payload.data?.app_id !== undefined || payload.data?.is_valid !== undefined) {
        const scopes = (payload.data.scopes ?? []).map((s) => s.scope);
        const required = IG_REQUIRED_SCOPES[
          account.access_token.startsWith('EAA') ? 'facebook_login' : 'instagram_login'
        ];
        return {
          checkedAt,
          status: 'ok',
          isValid: payload.data.is_valid ?? null,
          appId: payload.data.app_id ?? null,
          expiresAt: payload.data.expires_at ?? null,
          dataAccessExpiresAt: payload.data.data_access_expires_at ?? null,
          scopes,
          missingScopes: required.filter((s) => !scopes.includes(s)),
        };
      }
      lastError = payload.error?.message ?? `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    checkedAt,
    status: 'unknown',
    error: lastError || 'no app secret or token available for debug_token',
  };
}

async function appSecretProof(token: string, appSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const key = (accountId: string) => `health:token_debug:${accountId}`;

export async function saveTokenDebug(db: D1Database, accountId: string, info: TokenDebugInfo): Promise<void> {
  await db
    .prepare(
      `INSERT INTO integration_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
    )
    .bind(key(accountId), JSON.stringify(info))
    .run();
}

export async function loadTokenDebug(db: D1Database, accountId: string): Promise<TokenDebugInfo | null> {
  const row = await db.prepare('SELECT value FROM integration_settings WHERE key = ?').bind(key(accountId)).first<{ value: string }>();
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as TokenDebugInfo; } catch { return null; }
}

/** Run debug_token when the stored check is older than an hour (idempotent). */
export async function refreshTokenDebugIfNeeded(
  db: D1Database,
  env: CredentialEnv & { IG_APP_ID?: string; IG_APP_SECRET?: string },
  account: { id: string; ig_user_id: string; access_token: string; app_secret: string | null },
  appSecretOverride?: string | null,
): Promise<TokenDebugInfo | null> {
  const existing = await loadTokenDebug(db, account.id);
  if (existing && Date.parse(existing.checkedAt) > Date.now() - 3_600_000) return existing;
  const info = await debugAccountToken(env, account, appSecretOverride);
  await saveTokenDebug(db, account.id, info).catch(() => {});
  return info;
}
