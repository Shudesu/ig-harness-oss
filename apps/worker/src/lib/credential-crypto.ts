import { openToken, sealToken } from './token-crypto.js';
import { deriveKey, type TrackingEnv } from './tracking-token.js';
export type CredentialEnv = TrackingEnv & { TOKEN_ENCRYPTION_KEY?: string };
let warned = false;
async function fallbackKey(env: CredentialEnv): Promise<string | undefined> {
  const source = env.API_KEY || env.IG_APP_SECRET;
  return source ? btoa(String.fromCharCode(...await deriveKey(source, 'ig-credential-storage-v1'))) : undefined;
}
export async function sealCredential(value: string, subject: string, env: CredentialEnv): Promise<string> {
  if (!env.TOKEN_ENCRYPTION_KEY && !warned) { console.warn('[credentials] TOKEN_ENCRYPTION_KEY missing; using purpose-separated fallback'); warned = true; }
  return sealToken(value, subject, env.TOKEN_ENCRYPTION_KEY || await fallbackKey(env));
}
export async function openCredential(value: string, subject: string, env: CredentialEnv): Promise<string> {
  if (!value.startsWith('enc:')) return value;
  if (!value.startsWith('enc:v1:')) throw new Error('Unsupported credential encryption version');
  if (env.TOKEN_ENCRYPTION_KEY) {
    try { return await openToken(value, subject, env.TOKEN_ENCRYPTION_KEY); } catch { /* older fallback-encrypted rows */ }
  }
  return openToken(value, subject, await fallbackKey(env));
}
export async function readAppSecret(account: { ig_user_id: string; app_secret: string | null }, env: CredentialEnv): Promise<string | null> {
  return account.app_secret ? openCredential(account.app_secret, `ig-app-secret:${account.ig_user_id}`, env) : null;
}
/** Bounded, idempotent maintenance; optimistic comparison preserves concurrent rotations. */
export async function encryptLegacyCredentials(db: D1Database, env: CredentialEnv): Promise<void> {
  for (const [table, column, subjectColumn, prefix] of [
    ['ig_accounts', 'app_secret', 'ig_user_id', 'ig-app-secret:'],
    ['line_harness_connections', 'api_key', 'id', 'line-api-key:'],
  ] as const) {
    const rows = await db.prepare(`SELECT id, ${column} AS value, ${subjectColumn} AS subject FROM ${table} WHERE ${column} NOT LIKE 'enc:%' AND ${column} != '' LIMIT 20`).all<{ id: string; value: string; subject: string }>();
    for (const row of rows.results) await db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=? AND ${column}=?`).bind(await sealCredential(row.value, prefix + row.subject, env), row.id, row.value).run();
  }
}

export async function encryptLegacyLineConfig(db: D1Database, env: CredentialEnv): Promise<void> {
  const row = await db.prepare("SELECT value FROM integration_settings WHERE key='line_harness_api_key' AND value NOT LIKE 'enc:%' AND value != ''").first<{ value: string }>();
  if (row) await db.prepare("UPDATE integration_settings SET value=? WHERE key='line_harness_api_key' AND value=?").bind(await sealCredential(row.value, 'legacy-line-api-key', env), row.value).run();
}
