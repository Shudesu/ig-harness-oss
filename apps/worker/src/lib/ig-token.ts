const REFRESH_WINDOW_SECONDS = 14 * 24 * 60 * 60;

type TokenEnv = {
  IG_ACCESS_TOKEN: string;
  DB: D1Database;
};

type TokenRow = {
  access_token: string;
  expires_at: number;
  refreshed_at: number;
};

type StoredTokenResult =
  | { kind: 'ok'; row: TokenRow }
  | { kind: 'empty' }
  | { kind: 'missing_table' };

async function readStoredToken(env: TokenEnv): Promise<StoredTokenResult> {
  try {
    const row = await env.DB
      .prepare('SELECT access_token, expires_at, refreshed_at FROM ig_token_state WHERE id = 1')
      .first<TokenRow>();
    return row ? { kind: 'ok', row } : { kind: 'empty' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such table/i.test(msg)) {
      console.warn('ig_token_state table not found; run migration 0003_ig_token_state.sql');
      return { kind: 'missing_table' };
    }
    throw err;
  }
}

export async function getIGAccessToken(env: TokenEnv): Promise<string> {
  const result = await readStoredToken(env);
  if (result.kind === 'ok' && result.row.expires_at > Math.floor(Date.now() / 1000)) {
    return result.row.access_token;
  }
  return env.IG_ACCESS_TOKEN;
}

async function callRefresh(
  token: string,
): Promise<{ access_token: string; expires_in: number }> {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`IG token refresh failed: ${res.status} ${body}`);
  }
  const data = await res.json<{ access_token: string; expires_in: number }>();
  if (!data.access_token || !data.expires_in) {
    throw new Error(`IG token refresh returned invalid payload: ${JSON.stringify(data)}`);
  }
  return { access_token: data.access_token, expires_in: data.expires_in };
}

export async function refreshIGAccessTokenIfNeeded(
  env: TokenEnv,
): Promise<{ refreshed: boolean; reason: string; expiresAt?: number }> {
  const now = Math.floor(Date.now() / 1000);
  const result = await readStoredToken(env);

  // No point calling /refresh_access_token if we cannot persist the result.
  if (result.kind === 'missing_table') {
    return { refreshed: false, reason: 'ig_token_state table missing; skip refresh' };
  }

  const storedExpiresAt = result.kind === 'ok' ? result.row.expires_at : 0;
  if (storedExpiresAt > now + REFRESH_WINDOW_SECONDS) {
    return { refreshed: false, reason: 'token still fresh' };
  }

  // Try the stored token first (it may be newer than env after prior cron
  // refreshes) and fall back to the env secret if Meta rejects it — this lets
  // an operator recover by rotating IG_ACCESS_TOKEN without clearing D1.
  const storedToken = result.kind === 'ok' ? result.row.access_token : null;
  const candidates: string[] = [];
  if (storedToken) candidates.push(storedToken);
  if (env.IG_ACCESS_TOKEN && !candidates.includes(env.IG_ACCESS_TOKEN)) {
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
      console.warn('IG refresh attempt failed, trying next candidate if any:', err);
    }
  }
  if (!data) throw lastErr ?? new Error('IG token refresh: no candidate tokens available');

  const newExpiresAt = now + data.expires_in;
  await env.DB
    .prepare(
      `INSERT INTO ig_token_state (id, access_token, expires_at, refreshed_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         expires_at = excluded.expires_at,
         refreshed_at = excluded.refreshed_at`,
    )
    .bind(data.access_token, newExpiresAt, now)
    .run();

  return { refreshed: true, reason: 'ok', expiresAt: newExpiresAt };
}
