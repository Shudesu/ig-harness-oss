import { jstNow } from './utils.js';

/** Mirrors IgConnectionType in @ig-harness/ig-sdk (db must not depend on the SDK). */
export type IgAccountConnectionType = 'instagram_login' | 'facebook_login';

export interface IgAccount {
  id: string;
  ig_user_id: string;
  username: string | null;
  access_token: string;
  token_expires_at: number | null;
  token_refreshed_at: number | null;
  app_secret: string | null;
  verify_token: string | null;
  is_active: number;
  is_default: number;
  /** Added by 0025. Optional in the type so pre-0024 rows/fixtures read as instagram_login. */
  connection_type?: IgAccountConnectionType | null;
  page_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function accountConnectionType(account: Pick<IgAccount, 'connection_type'>): IgAccountConnectionType {
  return account.connection_type === 'facebook_login' ? 'facebook_login' : 'instagram_login';
}

export async function listIgAccounts(
  db: D1Database,
  opts: { activeOnly?: boolean } = {},
): Promise<IgAccount[]> {
  const sql = opts.activeOnly
    ? 'SELECT * FROM ig_accounts WHERE is_active = 1 ORDER BY is_default DESC, created_at ASC'
    : 'SELECT * FROM ig_accounts ORDER BY is_default DESC, created_at ASC';
  const result = await db.prepare(sql).all<IgAccount>();
  return result.results;
}

export async function getIgAccountById(db: D1Database, id: string): Promise<IgAccount | null> {
  return await db.prepare('SELECT * FROM ig_accounts WHERE id = ?').bind(id).first<IgAccount>();
}

export async function getIgAccountByIgUserId(
  db: D1Database,
  igUserId: string,
): Promise<IgAccount | null> {
  return await db
    .prepare('SELECT * FROM ig_accounts WHERE ig_user_id = ?')
    .bind(igUserId)
    .first<IgAccount>();
}

export async function getDefaultIgAccount(db: D1Database): Promise<IgAccount | null> {
  const def = await db
    .prepare('SELECT * FROM ig_accounts WHERE is_default = 1 LIMIT 1')
    .first<IgAccount>();
  if (def) return def;
  // Degenerate case: no row flagged default — oldest active account stands in.
  return await db
    .prepare('SELECT * FROM ig_accounts WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1')
    .first<IgAccount>();
}

export interface CreateIgAccountInput {
  igUserId: string;
  username?: string | null;
  accessToken: string;
  tokenExpiresAt?: number | null;
  tokenRefreshedAt?: number | null;
  /** Worker writes enc:v1 ciphertext with account-specific AAD; plaintext is legacy read compatibility only. */
  appSecret?: string | null;
  verifyToken?: string | null;
  isDefault?: boolean;
  connectionType?: IgAccountConnectionType;
  pageId?: string | null;
}

export async function createIgAccount(
  db: D1Database,
  input: CreateIgAccountInput,
): Promise<IgAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO ig_accounts
        (id, ig_user_id, username, access_token, token_expires_at, token_refreshed_at,
         app_secret, verify_token, is_active, is_default, created_at, updated_at,
         connection_type, page_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.igUserId,
      input.username ?? null,
      input.accessToken,
      input.tokenExpiresAt ?? null,
      input.tokenRefreshedAt ?? null,
      input.appSecret ?? null,
      input.verifyToken ?? null,
      input.isDefault ? 1 : 0,
      now,
      now,
      input.connectionType ?? 'instagram_login',
      input.pageId ?? null,
    )
    .run();
  return (await getIgAccountById(db, id))!;
}

export interface UpdateIgAccountInput {
  username?: string | null;
  accessToken?: string;
  /** Worker writes enc:v1 ciphertext with account-specific AAD; plaintext is legacy read compatibility only. */
  appSecret?: string | null;
  verifyToken?: string | null;
  isActive?: boolean;
  /** Only switched together with a validated replacement token. */
  connectionType?: IgAccountConnectionType;
  pageId?: string | null;
}

export async function updateIgAccount(
  db: D1Database,
  id: string,
  patch: UpdateIgAccountInput,
): Promise<IgAccount | null> {
  const existing = await getIgAccountById(db, id);
  if (!existing) return null;
  // A manually replaced token has an unknown expiry — clear it so the next
  // cron refresh re-learns it from Meta instead of trusting stale numbers.
  const tokenReplaced =
    patch.accessToken !== undefined && patch.accessToken !== existing.access_token;
  await db
    .prepare(
      `UPDATE ig_accounts SET
         username = ?, access_token = ?, app_secret = ?, verify_token = ?, is_active = ?,
         connection_type = ?, page_id = ?,
         token_expires_at = CASE WHEN ? THEN NULL ELSE token_expires_at END,
         token_refreshed_at = CASE WHEN ? THEN NULL ELSE token_refreshed_at END,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.username !== undefined ? patch.username : existing.username,
      patch.accessToken ?? existing.access_token,
      patch.appSecret !== undefined ? patch.appSecret : existing.app_secret,
      patch.verifyToken !== undefined ? patch.verifyToken : existing.verify_token,
      patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : existing.is_active,
      patch.connectionType ?? accountConnectionType(existing),
      patch.pageId !== undefined ? patch.pageId : existing.page_id ?? null,
      tokenReplaced ? 1 : 0,
      tokenReplaced ? 1 : 0,
      jstNow(),
      id,
    )
    .run();
  return await getIgAccountById(db, id);
}

export async function updateIgAccountToken(
  db: D1Database,
  id: string,
  accessToken: string,
  expiresAt: number,
  refreshedAt: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE ig_accounts SET access_token = ?, token_expires_at = ?, token_refreshed_at = ?, updated_at = ? WHERE id = ?',
    )
    .bind(accessToken, expiresAt, refreshedAt, jstNow(), id)
    .run();
}
