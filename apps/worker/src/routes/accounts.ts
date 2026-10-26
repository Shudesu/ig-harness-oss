import { recordTokenValidity } from '../lib/health.js';
import { InstagramApiError, InstagramTransportError } from '@ig-harness/ig-sdk';
import { validateIgAccount } from '../lib/validate-ig-account.js';
import { sealToken } from '../lib/token-crypto.js';
import { Hono } from 'hono';
import {
  listIgAccounts,
  getIgAccountById,
  getIgAccountByIgUserId,
  createIgAccount,
  updateIgAccount,
} from '@ig-harness/db';
import type { IgAccount } from '@ig-harness/db';
import { requireRole } from '../middleware/role-guard.js';
import { ensureDefaultAccount } from '../lib/accounts.js';
import type { Env } from '../index.js';

const accounts = new Hono<Env>();

/** Mask an access token down to `****` + last 4 chars — never echo full tokens. */
function maskToken(token: string): string {
  return `****${token.slice(-4)}`;
}

/** Convert a D1 snake_case IgAccount row to the API camelCase shape. */
function serializeAccount(row: IgAccount) {
  return {
    id: row.id,
    igUserId: row.ig_user_id,
    username: row.username,
    accessToken: maskToken(row.access_token),
    tokenExpiresAt: row.token_expires_at,
    hasAppSecret: Boolean(row.app_secret),
    hasVerifyToken: Boolean(row.verify_token),
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/accounts - list all IG accounts (tokens masked)
accounts.get('/api/accounts', requireRole('owner', 'admin'), async (c) => {
  try {
    await ensureDefaultAccount(c.env, c.env.DB);
    const items = await listIgAccounts(c.env.DB);
    return c.json({ success: true, data: items.map(serializeAccount) });
  } catch (err) {
    console.error('GET /api/accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/accounts - register an additional IG account
accounts.post('/api/accounts', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{
      igUserId?: string;
      username?: string | null;
      accessToken?: string;
      appSecret?: string | null;
      verifyToken?: string | null;
    }>();

    if ((body.igUserId !== undefined && (typeof body.igUserId !== 'string' || !/^\d{1,64}$/.test(body.igUserId))) || typeof body.accessToken !== 'string' || !body.accessToken.trim() || body.accessToken.length>8192) {
      return c.json({ success: false, error: 'A token and an optional numeric igUserId are required' }, 400);
    }

    let profile;
    try { profile=await validateIgAccount(c.env,body.accessToken,body.igUserId,body.appSecret); }
    catch (error) { return c.json({ success:false,error:error instanceof InstagramApiError ? `Instagram token validation failed (code ${error.code ?? error.status}). Check Instagram Login permissions.` : error instanceof InstagramTransportError ? 'Could not reach Instagram; account was not saved.' : (error as Error).message },error instanceof InstagramTransportError?502:400); }
    const igUserId=profile.user_id;
    // Seed the env-based default first so a newly added account can never
    // become the default by being the first ig_accounts row.
    await ensureDefaultAccount(c.env, c.env.DB);

    const existing = await getIgAccountByIgUserId(c.env.DB, igUserId);
    if (existing) {
      return c.json({ success: false, error: 'an account with this igUserId already exists' }, 409);
    }

    const account = await createIgAccount(c.env.DB, {
      igUserId,
      username: profile.username,
      accessToken: await sealToken(body.accessToken, igUserId, c.env.TOKEN_ENCRYPTION_KEY),
      appSecret: body.appSecret ?? null,
      verifyToken: body.verifyToken ?? null,
    });

    await recordTokenValidity(c.env.DB,account.id,true).catch(()=>{});
    return c.json({ success: true, data: { ...serializeAccount(account), verification: 'profile_only' } }, 201);
  } catch (err) {
    console.error('POST /api/accounts error:', err instanceof Error ? err.name : 'unknown');
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/accounts/:id - update account credentials / status
accounts.patch('/api/accounts/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      username?: string | null;
      accessToken?: string;
      appSecret?: string | null;
      verifyToken?: string | null;
      isActive?: boolean;
    }>();

    const existing = await getIgAccountById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'account not found' }, 404);
    }

    if (existing.is_default === 1 && body.isActive === false) {
      return c.json({ success: false, error: 'default account cannot be deactivated' }, 400);
    }

    let verifiedUsername = body.username;
    if (body.accessToken !== undefined) {
      if (typeof body.accessToken !== 'string' || !body.accessToken.trim() || body.accessToken.length>8192) return c.json({ success:false,error:'accessToken must not be empty' },400);
      try { verifiedUsername=(await validateIgAccount(c.env,body.accessToken,existing.ig_user_id,body.appSecret ?? existing.app_secret)).username; }
      catch (error) { return c.json({ success:false,error:error instanceof InstagramApiError ? `Instagram token validation failed (code ${error.code ?? error.status}). Existing credentials were preserved.` : error instanceof InstagramTransportError ? 'Could not reach Instagram; existing credentials were preserved.' : (error as Error).message },error instanceof InstagramTransportError?502:400); }
    }
    const updated = await updateIgAccount(c.env.DB, id, {
      username: verifiedUsername,
      accessToken: body.accessToken === undefined ? undefined : await sealToken(body.accessToken, existing.ig_user_id, c.env.TOKEN_ENCRYPTION_KEY),
      appSecret: body.appSecret,
      verifyToken: body.verifyToken,
      isActive: body.isActive,
    });

    if (body.accessToken !== undefined) await recordTokenValidity(c.env.DB,id,true).catch(()=>{});
    if (body.accessToken !== undefined) await c.env.DB.prepare("DELETE FROM integration_settings WHERE key IN (?,?)").bind(`health:graph_backoff_until:${id}`,`health:token_refresh_attempt:${id}`).run();
    return c.json({ success: true, data: updated ? serializeAccount(updated) : null });
  } catch (err) {
    console.error('PATCH /api/accounts/:id error:', err instanceof Error ? err.name : 'unknown');
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { accounts };
