import { sealToken } from './token-crypto.js';
import { updateIgAccountToken, type IgAccount } from '@ig-harness/db';

const REFRESH_WINDOW_SECONDS = 14 * 24 * 60 * 60;

async function callRefresh(
  token: string,
): Promise<{ access_token: string; expires_in: number }> {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`IG token refresh failed: ${res.status}`);
  }
  const data = await res.json<{ access_token: string; expires_in: number }>();
  if (!data.access_token || !data.expires_in) {
    throw new Error('IG token refresh returned invalid payload');
  }
  return { access_token: data.access_token, expires_in: data.expires_in };
}

/**
 * Per-account variant of the refresh flow. Stores the result on the
 * ig_accounts row (the legacy ig_token_state singleton stays untouched —
 * it only serves as a seed source for ensureDefaultAccount now).
 *
 * A NULL token_expires_at (fresh registration or manual token replacement)
 * counts as "needs refresh" so the expiry gets learned from Meta on the
 * next cron tick.
 */
export async function refreshAccountTokenIfNeeded(
  env: { IG_ACCESS_TOKEN: string; TOKEN_ENCRYPTION_KEY?: string },
  db: D1Database,
  account: IgAccount,
): Promise<{ refreshed: boolean; token?: string; reason: string }> {
  const now = Math.floor(Date.now() / 1000);
  if (account.token_expires_at && account.token_expires_at > now + REFRESH_WINDOW_SECONDS) {
    return { refreshed: false, reason: 'token still fresh' };
  }
  const attemptKey = `health:token_refresh_attempt:${account.id}`;
  const attempt = await db.prepare('SELECT value FROM integration_settings WHERE key=?').bind(attemptKey).first<{ value: string }>();
  if (attempt?.value && Number(attempt.value) > now - 3600) return { refreshed: false, reason: 'refresh cooldown' };
  await db.prepare("INSERT INTO integration_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(attemptKey, String(now)).run();
  // Candidates: the stored per-account token, plus the env secret as a
  // recovery path for the default account only (the env token belongs to it).
  const candidates: string[] = [account.access_token];
  if (account.is_default === 1 && env.IG_ACCESS_TOKEN && !candidates.includes(env.IG_ACCESS_TOKEN)) {
    candidates.push(env.IG_ACCESS_TOKEN);
  }
  let data: { access_token: string; expires_in: number } | null = null;
  let lastErr: unknown;
  for (const tok of candidates) {
    try {
      data = await callRefresh(tok);
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`IG refresh failed for account ${account.ig_user_id}, trying next candidate:`, err);
    }
  }
  if (!data) throw lastErr ?? new Error('IG token refresh: no candidate tokens available');

  const expiresAt = now + data.expires_in;
  await updateIgAccountToken(db, account.id, await sealToken(data.access_token, account.ig_user_id, env.TOKEN_ENCRYPTION_KEY), expiresAt, now);
  // Mutate the in-memory row so the caller's client uses the new token.
  account.access_token = data.access_token;
  account.token_expires_at = expiresAt;
  account.token_refreshed_at = now;
  return { refreshed: true, token: data.access_token, reason: 'ok' };
}
