import { listIgAccounts } from '@ig-harness/db';

// Upsert a key-value pair into integration_settings.
const upsertSetting = (db: D1Database, key: string, value: string) =>
  db
    .prepare(
      `INSERT INTO integration_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
    )
    .bind(key, value)
    .run();

// Record the timestamp of a webhook event for an account.
export async function recordWebhookReceived(db: D1Database, accountId: string): Promise<void> {
  await upsertSetting(db, `health:last_webhook_at:${accountId}`, new Date().toISOString());
}

// Record the timestamp of the most recent cron execution.
export async function recordCronRun(db: D1Database): Promise<void> {
  await upsertSetting(db, 'health:last_cron_at', new Date().toISOString());
}

// Increment the DM failure counter for a given account and day (UTC date).
export async function recordDmFailure(db: D1Database, accountId: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `INSERT INTO integration_settings (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
    )
    .bind(`health:dm_failures:${accountId}:${day}`)
    .run();
}

// Record the result of an actual Graph API liveness probe (GET /me).
// Catches checkpoint/freeze invalidation (code 190) that expiry math misses.
export async function recordTokenValidity(
  db: D1Database,
  accountId: string,
  ok: boolean,
): Promise<void> {
  await upsertSetting(
    db,
    `health:token_valid:${accountId}`,
    JSON.stringify({ ok, checked_at: new Date().toISOString() }),
  );
}

export interface AccountHealth {
  account_id: string;
  username: string | null;
  /** Unix seconds from ig_accounts.token_expires_at */
  token_expires_at: number | null;
  token_days_left: number | null;
  /** Result of the last real Graph API call (GET /me); null = never probed */
  token_api_ok: boolean | null;
  token_api_checked_at: string | null;
  last_webhook_event_at: string | null;
  dm_failures_today: number;
}

export interface HealthSnapshot {
  /** db_ok && all account tokens not yet expired */
  ok: boolean;
  checked_at: string;
  accounts: AccountHealth[];
  /** Count of messages_log rows with direction='out' in the past 24 hours */
  dm_sent_24h: number;
  cron_last_run_at: string | null;
  db_ok: boolean;
}

// Build a point-in-time health snapshot from D1. Never throws — returns
// db_ok=false with empty data if the DB is unavailable.
export async function getHealthSnapshot(db: D1Database): Promise<HealthSnapshot> {
  const checked_at = new Date().toISOString();
  try {
    const accounts = await listIgAccounts(db, { activeOnly: true });

    const settingsResult = await db
      .prepare(`SELECT key, value FROM integration_settings WHERE key LIKE 'health:%'`)
      .all<{ key: string; value: string }>();
    const map = new Map((settingsResult.results ?? []).map((r) => [r.key, r.value]));

    const day = checked_at.slice(0, 10);
    const nowSec = Math.floor(Date.now() / 1000);

    const accountHealth: AccountHealth[] = accounts.map((a) => {
      let tokenApiOk: boolean | null = null;
      let tokenApiCheckedAt: string | null = null;
      const validity = map.get(`health:token_valid:${a.id}`);
      if (validity) {
        try {
          const parsed = JSON.parse(validity) as { ok?: boolean; checked_at?: string };
          tokenApiOk = parsed.ok ?? null;
          tokenApiCheckedAt = parsed.checked_at ?? null;
        } catch {
          // Malformed value — treat as never probed.
        }
      }
      return {
        account_id: a.id,
        username: a.username ?? null,
        token_expires_at: a.token_expires_at ?? null,
        token_days_left:
          a.token_expires_at != null
            ? Math.floor((a.token_expires_at - nowSec) / 86400)
            : null,
        token_api_ok: tokenApiOk,
        token_api_checked_at: tokenApiCheckedAt,
        last_webhook_event_at: map.get(`health:last_webhook_at:${a.id}`) ?? null,
        dm_failures_today: Number(map.get(`health:dm_failures:${a.id}:${day}`) ?? '0'),
      };
    });

    const sent = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages_log
         WHERE direction = 'out'
           AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now', '-1 day'))`,
      )
      .first<{ n: number }>();

    // ok is false only when a token has actually expired. Compare the raw
    // timestamp: token_days_left floors to 0 for tokens still valid <24h.
    // Accounts with null token_expires_at are treated as unknown (not expired).
    // Zero active accounts means the deployment was never seeded — that is
    // not a healthy state, even though there is no token to fail.
    const allTokensValid =
      accountHealth.length > 0 &&
      accountHealth.every(
        (a) => a.token_expires_at == null || a.token_expires_at > nowSec,
      ) &&
      // A probed-dead token (checkpoint/freeze, code 190) is unhealthy even
      // when its expiry timestamp is still in the future.
      accountHealth.every((a) => a.token_api_ok !== false);

    return {
      ok: allTokensValid,
      checked_at,
      accounts: accountHealth,
      dm_sent_24h: sent?.n ?? 0,
      cron_last_run_at: map.get('health:last_cron_at') ?? null,
      db_ok: true,
    };
  } catch (err) {
    console.error('[health] getHealthSnapshot error:', err);
    return {
      ok: false,
      checked_at,
      accounts: [],
      dm_sent_24h: 0,
      cron_last_run_at: null,
      db_ok: false,
    };
  }
}
