import { Hono } from 'hono';
import { listIgAccounts } from '@ig-harness/db';
import { escapeHtml, sha256, verifySignedRequest } from '../lib/security.js';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

export const dataDeletion = new Hono<Env>();
type DeletionRequest = { code: string; app_fingerprint: string; status: 'pending_identity' | 'completed'; meta_user_id: string | null };

// Meta's user_id is app-scoped. It is NOT an Instagram messaging IGSID.
// This token-based self-hosted installer has no OAuth identity mapping. An
// owner must verify the subject before resolving a request; never guess an ID.
dataDeletion.post('/data-deletion', async (c) => {
  const raw = await c.req.text();
  if (raw.length > 16_384) return c.json({ error: 'Request too large' }, 413);
  let signed: unknown;
  try {
    signed = c.req.header('content-type')?.includes('application/json')
      ? JSON.parse(raw).signed_request : new URLSearchParams(raw).get('signed_request');
  } catch { return c.json({ error: 'Invalid signed request' }, 400); }
  if (typeof signed !== 'string' || signed.length > 8192) return c.json({ error: 'Invalid signed request' }, 400);
  const accounts = await listIgAccounts(c.env.DB);
  const secrets = [...new Set([c.env.IG_APP_SECRET, ...accounts.map((a) => a.app_secret)].filter((s): s is string => !!s))];
  let subject: string | undefined;
  let fingerprint = '';
  for (const secret of secrets) {
    const verified = await verifySignedRequest(signed, secret);
    if (verified) { subject = verified.user_id; fingerprint = await sha256(secret); break; }
  }
  if (!subject) return c.json({ error: 'Invalid signed request' }, 403);
  const requestHash = await sha256(signed);
  const code = crypto.randomUUID().replaceAll('-', '');
  await c.env.DB.prepare(`INSERT OR IGNORE INTO data_deletion_requests
    (code, request_hash, subject_hash, app_fingerprint, meta_user_id, status, requested_at)
    VALUES (?, ?, ?, ?, ?, 'pending_identity', ?)`)
    .bind(code, requestHash, await sha256(`${fingerprint}:${subject}`), fingerprint, subject, new Date().toISOString()).run();
  const record = await c.env.DB.prepare('SELECT code FROM data_deletion_requests WHERE request_hash = ?').bind(requestHash).first<{ code: string }>();
  if (!record) throw new Error('Deletion request was not persisted');
  const url = new URL('/data-deletion', c.req.url);
  url.searchParams.set('code', record.code);
  return c.json({ url: url.href, confirmation_code: record.code });
});

dataDeletion.get('/data-deletion', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  const code = c.req.query('code');
  if (!code) return c.html('<h1>Data deletion</h1><p>Request deletion through Meta, or contact this instance’s operator. Requests are completed only after the affected account is identified and its data removed.</p>');
  if (!/^[a-f0-9]{32}$/.test(code)) return c.text('Unknown confirmation code', 404);
  const record = await c.env.DB.prepare('SELECT status FROM data_deletion_requests WHERE code = ?').bind(code).first<{ status: string }>();
  if (!record) return c.text('Unknown confirmation code', 404);
  const status = record.status === 'completed' ? 'Deletion completed.' : 'Request received. Awaiting identity verification by the instance operator. Data has not yet been deleted.';
  return c.html(`<h1>Data deletion request</h1><p>Confirmation code: ${escapeHtml(code)}</p><p>${status}</p>`);
});

dataDeletion.get('/api/data-deletion', requireRole('owner'), async (c) => {
  const rows = await c.env.DB.prepare("SELECT code, meta_user_id, status, requested_at FROM data_deletion_requests WHERE status = 'pending_identity' ORDER BY requested_at LIMIT 100").all();
  return c.json({ success: true, data: rows.results });
});

// Explicit operator resolution, after matching the Meta app-scoped identity.
// The entire purge and completed marker share a D1 batch transaction.
dataDeletion.post('/api/data-deletion/:code/resolve', requireRole('owner'), async (c) => {
  const request = await c.env.DB.prepare('SELECT * FROM data_deletion_requests WHERE code = ?').bind(c.req.param('code')).first<DeletionRequest>();
  if (!request) return c.json({ error: 'Request not found' }, 404);
  if (request.status === 'completed') return c.json({ success: true, status: 'completed' });
  const body = await c.req.json<{ accountId: string; followerId?: number; identityVerified?: boolean }>();
  if (body.identityVerified !== true || !body.accountId) return c.json({ error: 'Verified identity and accountId are required' }, 400);
  if (body.followerId !== undefined && (!Number.isSafeInteger(body.followerId) || body.followerId < 1)) return c.json({ error: 'Invalid followerId' }, 400);
  const account = (await listIgAccounts(c.env.DB)).find((a) => a.id === body.accountId);
  if (!account || await sha256(account.app_secret || c.env.IG_APP_SECRET) !== request.app_fingerprint) return c.json({ error: 'Account is outside the signed request app' }, 400);
  const db = c.env.DB;
  const scoped = body.followerId !== undefined;
  const condition = `account_id = ?${scoped ? ' AND id = ?' : ''}`;
  const values = scoped ? [account.id, body.followerId!] : [account.id];
  if (scoped && !await db.prepare(`SELECT id FROM followers WHERE ${condition}`).bind(...values).first()) return c.json({ error: 'Follower not found in account' }, 404);
  await db.prepare('INSERT OR IGNORE INTO data_deletion_locks(account_id,request_code) VALUES (?,?)').bind(account.id, request.code).run();
  const lock = await db.prepare('SELECT request_code FROM data_deletion_locks WHERE account_id=?').bind(account.id).first<{ request_code: string }>();
  if (lock?.request_code !== request.code) return c.json({ error: 'Another deletion is in progress for this account' }, 409);
  const statements: D1PreparedStatement[] = [];
  // No ambiguous send may remain in flight while data is being removed.
  const busy = await db.prepare(`SELECT 1 FROM broadcast_recipients r JOIN followers f ON f.id=r.follower_id WHERE f.account_id=? AND r.status='processing'
    UNION ALL SELECT 1 FROM webhook_events WHERE account_id=? AND status='processing'
    UNION ALL SELECT 1 FROM comment_rule_jobs WHERE account_id=? AND status='processing'
    UNION ALL SELECT 1 FROM active_mutations LIMIT 1`).bind(account.id, account.id, account.id).first();
  if (busy) return c.json({ error: 'Account has in-flight delivery work; retry after it settles' }, 409);
  for (const table of ['messages_log', 'link_clicks', 'form_submissions', 'follower_scenarios', 'follower_tags', 'gate_deliveries', 'broadcast_recipients', 'comment_rule_jobs']) {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE follower_id IN (SELECT id FROM followers WHERE ${condition})`).bind(...values));
  }
  statements.push(db.prepare(`DELETE FROM gate_clicks WHERE gate_id IN (SELECT id FROM engagement_gates WHERE account_id=?) AND igsid IN (SELECT igsid FROM followers WHERE ${condition})`).bind(account.id, ...values));
  // Raw event payload can contain the subject even before a follower exists.
  // Remove payloads for this account and retain dedup keys to prevent replay.
  statements.push(db.prepare(`UPDATE webhook_events SET payload=NULL, subject_id=NULL, status='completed', finished_at=? WHERE account_id=?${scoped ? ` AND subject_id IN (SELECT igsid FROM followers WHERE ${condition})` : ''}`).bind(new Date().toISOString(), account.id, ...(scoped ? values : [])));
  statements.push(db.prepare(`DELETE FROM followers WHERE ${condition}`).bind(...values));
  if (!scoped) {
    for (const table of ['media_posts', 'broadcasts', 'engagement_gates', 'scenarios', 'forms', 'tracked_links', 'tags', 'rich_messages', 'comment_rules']) {
      statements.push(db.prepare(`DELETE FROM ${table} WHERE account_id=?`).bind(account.id));
    }
    // Keep the account tombstone so a stale env token cannot recreate it.
    statements.push(db.prepare("UPDATE ig_accounts SET ig_user_id='deleted:' || id, access_token='', app_secret=NULL, verify_token=NULL, username=NULL, token_expires_at=NULL, token_refreshed_at=NULL, is_active=0 WHERE id=?").bind(account.id));
    if (account.is_default) statements.push(db.prepare('DELETE FROM ig_token_state WHERE id=1'));
  }
  statements.push(db.prepare("UPDATE data_deletion_requests SET status='completed', meta_user_id=NULL, completed_at=? WHERE code=?").bind(new Date().toISOString(), request.code));
  statements.push(db.prepare('DELETE FROM data_deletion_locks WHERE account_id=? AND request_code=?').bind(account.id, request.code));
  await db.batch(statements);
  return c.json({ success: true, status: 'completed' });
});
