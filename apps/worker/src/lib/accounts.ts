import { InstagramClient } from '@ig-harness/ig-sdk';
import {
  getDefaultIgAccount,
  getIgAccountById,
  getIgAccountByIgUserId,
  createIgAccount,
  type IgAccount,
} from '@ig-harness/db';
import type { Context } from 'hono';
import type { IgAccountRef } from '../services/line-cross-link.js';
import { refreshAccountTokenIfNeeded } from './ig-token.js';
import type { Env } from '../index.js';

export type AccountEnv = {
  IG_USER_ID: string;
  IG_USERNAME?: string;
  IG_ACCESS_TOKEN: string;
};

const BACKFILL_TABLES = [
  'followers',
  'tags',
  'comment_rules',
  'scenarios',
  'broadcasts',
  'engagement_gates',
  'forms',
  'tracked_links',
  'rich_messages',
] as const;

const BACKFILL_FLAG_KEY = 'account_backfill_done';

/**
 * Stamp legacy NULL account_id rows with the default account id. Idempotent.
 * Sets a completion flag only when every table succeeded so a transient D1
 * failure on the first run is retried by later requests instead of leaving
 * rows invisible to the new account-scoped queries.
 */
async function backfillLegacyRows(db: D1Database, accountId: string): Promise<void> {
  let allOk = true;
  for (const table of BACKFILL_TABLES) {
    try {
      await db
        .prepare(`UPDATE ${table} SET account_id = ? WHERE account_id IS NULL`)
        .bind(accountId)
        .run();
    } catch (err) {
      allOk = false;
      console.error(`[accounts] backfill failed for ${table}:`, err);
    }
  }
  if (allOk) {
    try {
      await db
        .prepare(
          `INSERT INTO integration_settings (key, value) VALUES (?, '1')
           ON CONFLICT(key) DO UPDATE SET value = '1'`,
        )
        .bind(BACKFILL_FLAG_KEY)
        .run();
    } catch (err) {
      console.error('[accounts] backfill flag write failed (will retry):', err);
    }
  }
}

/**
 * Lazy migration for pre-multi-account deploys: when ig_accounts is empty,
 * seed the default account from env (preferring a fresher token from the
 * legacy ig_token_state singleton) and stamp every legacy row with its id.
 * Idempotent — returns immediately once any account row exists. Concurrent
 * first requests are resolved by the ig_user_id UNIQUE constraint: the loser
 * re-reads the winner's row and both backfill with the same id.
 */
export async function ensureDefaultAccount(env: AccountEnv, db: D1Database): Promise<void> {
  const existing = await db.prepare('SELECT id FROM ig_accounts LIMIT 1').first<{ id: string }>();
  if (existing) {
    // Seed already happened — but verify the legacy backfill completed.
    // A transient D1 error during the first run must not strand NULL rows
    // forever (scoped queries would never see them again).
    try {
      const flag = await db
        .prepare('SELECT value FROM integration_settings WHERE key = ?')
        .bind(BACKFILL_FLAG_KEY)
        .first<{ value: string }>();
      if (flag?.value === '1') return;
    } catch {
      // integration_settings missing (very old DB) — fall through to backfill.
    }
    const def = await getDefaultIgAccount(db);
    if (def) await backfillLegacyRows(db, def.id);
    return;
  }
  if (!env.IG_USER_ID) return;

  let accessToken = env.IG_ACCESS_TOKEN;
  let expiresAt: number | null = null;
  let refreshedAt: number | null = null;
  try {
    const row = await db
      .prepare('SELECT access_token, expires_at, refreshed_at FROM ig_token_state WHERE id = 1')
      .first<{ access_token: string; expires_at: number; refreshed_at: number }>();
    if (row && row.expires_at > Math.floor(Date.now() / 1000)) {
      accessToken = row.access_token;
      expiresAt = row.expires_at;
      refreshedAt = row.refreshed_at;
    }
  } catch {
    // Legacy table may not exist on fresh installs — env token is fine.
  }

  let accountId: string;
  try {
    const created = await createIgAccount(db, {
      igUserId: env.IG_USER_ID,
      username: env.IG_USERNAME ?? null,
      accessToken,
      tokenExpiresAt: expiresAt,
      tokenRefreshedAt: refreshedAt,
      isDefault: true,
    });
    accountId = created.id;
  } catch {
    const winner = await getIgAccountByIgUserId(db, env.IG_USER_ID);
    if (!winner) throw new Error('ensureDefaultAccount: seed failed');
    accountId = winner.id;
  }

  await backfillLegacyRows(db, accountId);
}

/** Resolve the acting account for an API request: ?account_id= or default. */
export async function resolveAccount(c: Context<Env>): Promise<IgAccount | null> {
  await ensureDefaultAccount(c.env, c.env.DB);
  const qid = c.req.query('account_id');
  if (qid) return await getIgAccountById(c.env.DB, qid);
  return await getDefaultIgAccount(c.env.DB);
}

/**
 * Pure routing helper for webhook entries. entry.id is the receiving
 * business account's IG user id; unknown ids fall back to the only active
 * account (Meta test payloads, legacy single-account deploys) and are
 * ambiguous — thus skipped — once a second account exists.
 */
export function pickAccountForEntry(accounts: IgAccount[], entryId: string): IgAccount | null {
  const active = accounts.filter((a) => a.is_active === 1);
  const matched = accounts.find((a) => a.ig_user_id === entryId);
  if (matched) return matched.is_active === 1 ? matched : null;
  return active.length === 1 ? active[0]! : null;
}

export function toIgAccountRef(account: IgAccount): IgAccountRef {
  return { id: account.ig_user_id, username: account.username ?? undefined };
}

/** Per-account client. Refreshes the token in-band when it is near expiry. */
export async function getAccountClient(
  env: AccountEnv,
  db: D1Database,
  account: IgAccount,
): Promise<InstagramClient> {
  let token = account.access_token;
  try {
    const refreshed = await refreshAccountTokenIfNeeded(env, db, account);
    if (refreshed.token) token = refreshed.token;
  } catch (err) {
    console.error(
      `[accounts] token refresh failed for ${account.ig_user_id}, using stored token:`,
      err,
    );
  }
  return new InstagramClient({ accessToken: token, igUserId: account.ig_user_id });
}
