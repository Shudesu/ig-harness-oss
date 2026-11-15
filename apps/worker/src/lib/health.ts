import { listIgAccounts } from '@ig-harness/db';
import { parseConnectionReport, type ConnectionReport } from './account-connection.js';
import type { TokenDebugInfo } from './token-debug.js';

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
  const previous = await db.prepare('SELECT value FROM integration_settings WHERE key = ?').bind('health:last_cron_at').first<{ value: string }>();
  if (previous?.value && Date.parse(previous.value) > Date.now() - 15 * 60_000) return;
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

// ── Webhook signature counters (B-02) ──
// Hourly buckets, same pattern as dm_failures, so the connection-health check
// can tell "the last hour had failures and no successes" (secret missing or
// wrong → every event rejected) apart from a quiet webhook endpoint.
// lastAt lives in a separate non-bucketed key so it needs no JSON upsert.

/**
 * Record a webhook signature verification failure. Only entry ids are read
 * from the unverified body — enough to estimate the account — and the event
 * itself is never processed. Account ids come from the caller's estimation
 * (may be empty → recorded under `unknown`).
 */
export async function recordSignatureFailure(db: D1Database, accountIds: string[]): Promise<void> {
  await bumpSignatureCounter(db, 'health:sig_fail:', 'health:sig_fail_last:', accountIds.length ? accountIds : ['unknown']);
}

/** Record a webhook signature verification success (per matched account). */
export async function recordSignatureSuccess(db: D1Database, accountIds: string[]): Promise<void> {
  if (!accountIds.length) return;
  await bumpSignatureCounter(db, 'health:sig_ok:', 'health:sig_ok_last:', accountIds);
}

async function bumpSignatureCounter(db: D1Database, bucketPrefix: string, lastKeyPrefix: string, accountIds: string[]): Promise<void> {
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const now = new Date().toISOString();
  for (const accountId of accountIds) {
    await db
      .prepare(
        `INSERT INTO integration_settings (key, value) VALUES (?, '1')
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
      )
      .bind(`${bucketPrefix}${accountId}:${hour}`)
      .run()
      .catch(() => {});
    await db
      .prepare(
        `INSERT INTO integration_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
      )
      .bind(`${lastKeyPrefix}${accountId}`, now)
      .run()
      .catch(() => {});
  }
}

/** Latest hour buckets to scan; recomputed per call so a long-lived isolate keeps counting. */
function signatureHoursNow(): string[] {
  return [0, -1].map((offset) => new Date(Date.now() + offset * 3_600_000).toISOString().slice(0, 13));
}

/** Sum of signature failures over the current and previous hour buckets. Accepts a Map or a plain settings record. */
export function signatureFailures1h(map: { get(key: string): string | undefined }, accountId: string): number {
  return signatureHoursNow().reduce((sum, hour) => sum + (Number(map.get(`health:sig_fail:${accountId}:${hour}`) ?? '0') || 0), 0);
}

/** Sum of signature successes over the current and previous hour buckets. Accepts a Map or a plain settings record. */
export function signatureSuccesses1h(map: { get(key: string): string | undefined }, accountId: string): number {
  return signatureHoursNow().reduce((sum, hour) => sum + (Number(map.get(`health:sig_ok:${accountId}:${hour}`) ?? '0') || 0), 0);
}

/** Latest failure or success timestamp (failure takes precedence; null = none). */
export function signatureLastAt(map: { get(key: string): string | undefined }, accountId: string): string | null {
  return map.get(`health:sig_fail_last:${accountId}`) ?? map.get(`health:sig_ok_last:${accountId}`) ?? null;
}

/** Delete signature buckets older than 3 hours (called from cron). */
export async function pruneSignatureBuckets(db: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 13);
  await db
    .prepare(
      `DELETE FROM integration_settings WHERE (key LIKE 'health:sig_fail:%' OR key LIKE 'health:sig_ok:%')
       AND key NOT LIKE 'health:sig_fail_last:%' AND key NOT LIKE 'health:sig_ok_last:%'
       AND substr(key, -13) < ?`,
    )
    .bind(cutoff)
    .run()
    .catch(() => {});
}

// Record the result of an actual Graph API liveness probe (GET /me).
// Catches checkpoint/freeze invalidation (code 190) that expiry math misses.
export async function recordTokenValidity(
  db: D1Database,
  accountId: string,
  ok: boolean,
  reason?: string,
): Promise<void> {
  await upsertSetting(
    db,
    `health:token_valid:${accountId}`,
    JSON.stringify({ ok, checked_at: new Date().toISOString(), reason }),
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
  token_api_reason?: string | null;
  last_webhook_event_at: string | null;
  dm_failures_today: number;
  graph_usage?: Record<string, number> | null;
  graph_backoff_until?: string | null;
  /** Last webhook-subscription / permission check (null = never run). */
  connection?: ConnectionReport | null;
  /** B-04: real token inspection from GET /debug_token (null = never run). */
  token_debug?: TokenDebugInfo | null;
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
      let tokenApiReason: string | null = null;
      const validity = map.get(`health:token_valid:${a.id}`);
      if (validity) {
        try {
          const parsed = JSON.parse(validity) as { ok?: boolean; checked_at?: string; reason?: string };
          tokenApiOk = parsed.ok ?? null;
          tokenApiCheckedAt = parsed.checked_at ?? null;
          tokenApiReason = parsed.reason ?? null;
        } catch {
          // Malformed value — treat as never probed.
        }
      }
      let usage: Record<string,number> | null=null;
      try { usage=JSON.parse(map.get(`health:graph_usage:${a.id}`) ?? 'null'); } catch { /* no valid snapshot */ }
      const backoff=Number(map.get(`health:graph_backoff_until:${a.id}`) ?? 0);
      let tokenDebug: TokenDebugInfo | null = null;
      const debugRaw = map.get(`health:token_debug:${a.id}`);
      if (debugRaw) { try { tokenDebug = JSON.parse(debugRaw) as TokenDebugInfo; } catch { /* malformed record */ } }
      return {
        graph_usage: usage,
        graph_backoff_until: Number.isFinite(backoff) && backoff>Date.now() ? new Date(backoff).toISOString() : null,
        account_id: a.id,
        username: a.username ?? null,
        token_expires_at: a.token_expires_at ?? null,
        token_days_left:
          a.token_expires_at != null
            ? Math.floor((a.token_expires_at - nowSec) / 86400)
            : null,
        token_api_ok: tokenApiOk,
        token_api_checked_at: tokenApiCheckedAt,
        token_api_reason: tokenApiReason,
        last_webhook_event_at: map.get(`health:last_webhook_at:${a.id}`) ?? null,
        dm_failures_today: Number(map.get(`health:dm_failures:${a.id}:${day}`) ?? '0'),
        connection: parseConnectionReport(map.get(`health:connection:${a.id}`)),
        token_debug: tokenDebug,
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
      accountHealth.every((a) => a.token_api_ok !== false && !a.graph_backoff_until);

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
