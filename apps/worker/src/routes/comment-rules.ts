import { Hono } from 'hono';
import { jstNow } from '@ig-harness/db';
import { resolveAccount, getAccountClient } from '../lib/accounts.js';
import { loadModerationSettings, saveModerationSettings, parseModerationSettings, loadHiddenComments, unhideComment } from '../lib/comment-moderation.js';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const MAX_REPLY_TEXT = 2200;
/** undefined = not provided; null = default text; '' = no public reply. */
function readReplyText(body: { replyText?: unknown; replyComment?: unknown }): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  const raw = body.replyText !== undefined ? body.replyText : body.replyComment;
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || raw.length > MAX_REPLY_TEXT) return { ok: false, error: `replyText must be a string up to ${MAX_REPLY_TEXT} characters or null` };
  return { ok: true, value: raw };
}
function readReplyMode(value: unknown): { ok: true; value: 'thread' | 'mention' | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === 'thread' || value === 'mention') return { ok: true, value };
  return { ok: false, error: "replyMode must be 'thread' or 'mention'" };
}

const commentRules = new Hono<Env>();

interface CommentRuleRow {
  id: string;
  name: string;
  trigger_type: string;
  media_id: string | null;
  keyword: string | null;
  match_type: string;
  response_type: string;
  response_body: string;
  delay_seconds: number;
  reply_text: string | null;
  reply_mode: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function serialize(row: CommentRuleRow) {
  return {
    id: String(row.id),
    name: row.name,
    triggerType: row.trigger_type,
    mediaId: row.media_id,
    keyword: row.keyword,
    matchType: row.match_type,
    responseType: row.response_type,
    responseBody: JSON.parse(row.response_body),
    delaySeconds: row.delay_seconds,
    /** Public comment reply (separate from the DM body). null = default text, '' = none. */
    replyText: row.reply_text,
    replyMode: row.reply_mode === 'mention' ? 'mention' : 'thread',
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Recent delivery outcomes, scoped to the selected account. No message bodies.
commentRules.get('/api/comment-rule-deliveries', async c => {
  const account=await resolveAccount(c); if (!account) return c.json({success:false,error:'account not found'},404);
  const rows=await c.env.DB.prepare(`SELECT j.id,j.status,j.reason,j.delivery_mode AS deliveryMode,j.error_code AS errorCode,j.error_subcode AS errorSubcode,j.error_message AS errorMessage,
    j.reply_mode AS replyMode,j.public_reply_status AS publicReplyStatus,j.public_reply_error_code AS publicReplyErrorCode,j.public_reply_error_message AS publicReplyErrorMessage,COALESCE(j.finished_at,j.started_at,j.comment_created_at,j.due_at) AS createdAt,f.username
    FROM comment_rule_jobs j JOIN followers f ON f.id=j.follower_id WHERE j.account_id=? ORDER BY j.rowid DESC LIMIT 30`).bind(account.id).all();
  return c.json({success:true,data:rows.results});
});

// GET /api/comment-rules - list all
commentRules.get('/api/comment-rules', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const result = await c.env.DB
      .prepare(`SELECT * FROM comment_rules WHERE account_id = ? ORDER BY created_at DESC`)
      .bind(account.id)
      .all<CommentRuleRow>();
    return c.json({ success: true, data: result.results.map(serialize) });
  } catch (err) {
    console.error('GET /api/comment-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/comment-rules/:id - get single
commentRules.get('/api/comment-rules/:id', async (c) => {
  try {
    const row = await c.env.DB
      .prepare(`SELECT * FROM comment_rules WHERE id = ?`)
      .bind(c.req.param('id'))
      .first<CommentRuleRow>();
    if (!row) {
      return c.json({ success: false, error: 'Comment rule not found' }, 404);
    }
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('GET /api/comment-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/comment-rules - create
commentRules.post('/api/comment-rules', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const body = await c.req.json<{
      name: string;
      triggerType?: string;
      mediaId?: string;
      keyword?: string;
      matchType?: string;
      responseType: string;
      responseBody: Record<string, unknown>;
      delaySeconds?: number;
      replyText?: string | null;
      replyComment?: string | null;
      replyMode?: string;
    }>();

    const replyText = readReplyText(body);
    if (!replyText.ok) return c.json({ success: false, error: replyText.error }, 400);
    const replyMode = readReplyMode(body.replyMode);
    if (!replyMode.ok) return c.json({ success: false, error: replyMode.error }, 400);

    if (!body.name || !body.responseType || !body.responseBody) {
      return c.json(
        { success: false, error: 'name, responseType, and responseBody are required' },
        400,
      );
    }

    const now = jstNow();

    const inserted = await c.env.DB
      .prepare(
        `INSERT INTO comment_rules (name, trigger_type, media_id, keyword, match_type, response_type, response_body, delay_seconds, reply_text, reply_mode, is_active, account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) RETURNING id`,
      )
      .bind(
        body.name,
        body.triggerType || 'comment',
        body.mediaId || null,
        body.keyword || null,
        body.matchType || 'contains',
        body.responseType,
        JSON.stringify(body.responseBody),
        body.delaySeconds || 0,
        replyText.value ?? null,
        replyMode.value ?? 'thread',
        account.id,
        now,
        now,
      )
      .first<{ id: number }>();

    const row = await c.env.DB
      .prepare(`SELECT * FROM comment_rules WHERE id = ?`)
      .bind(inserted!.id)
      .first<CommentRuleRow>();

    return c.json({ success: true, data: serialize(row!) }, 201);
  } catch (err) {
    console.error('POST /api/comment-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/comment-rules/:id - update
commentRules.put('/api/comment-rules/:id', async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      triggerType?: string;
      mediaId?: string | null;
      keyword?: string | null;
      matchType?: string;
      responseType?: string;
      responseBody?: Record<string, unknown>;
      delaySeconds?: number;
      isActive?: boolean;
      replyText?: string | null;
      replyComment?: string | null;
      replyMode?: string;
    }>();
    const replyText = readReplyText(body);
    if (!replyText.ok) return c.json({ success: false, error: replyText.error }, 400);
    const replyMode = readReplyMode(body.replyMode);
    if (!replyMode.ok) return c.json({ success: false, error: replyMode.error }, 400);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
    if (body.triggerType !== undefined) { fields.push('trigger_type = ?'); values.push(body.triggerType); }
    if (body.mediaId !== undefined) { fields.push('media_id = ?'); values.push(body.mediaId); }
    if (body.keyword !== undefined) { fields.push('keyword = ?'); values.push(body.keyword); }
    if (body.matchType !== undefined) { fields.push('match_type = ?'); values.push(body.matchType); }
    if (body.responseType !== undefined) { fields.push('response_type = ?'); values.push(body.responseType); }
    if (body.responseBody !== undefined) { fields.push('response_body = ?'); values.push(JSON.stringify(body.responseBody)); }
    if (body.delaySeconds !== undefined) { fields.push('delay_seconds = ?'); values.push(body.delaySeconds); }
    if (body.isActive !== undefined) { fields.push('is_active = ?'); values.push(body.isActive ? 1 : 0); }
    if (replyText.value !== undefined) { fields.push('reply_text = ?'); values.push(replyText.value); }
    if (replyMode.value !== undefined) { fields.push('reply_mode = ?'); values.push(replyMode.value); }

    if (fields.length === 0) {
      const row = await c.env.DB
        .prepare(`SELECT * FROM comment_rules WHERE id = ?`)
        .bind(id)
        .first<CommentRuleRow>();
      if (!row) return c.json({ success: false, error: 'Comment rule not found' }, 404);
      return c.json({ success: true, data: serialize(row) });
    }

    fields.push('updated_at = ?');
    values.push(jstNow());
    values.push(id);

    await c.env.DB
      .prepare(`UPDATE comment_rules SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const row = await c.env.DB
      .prepare(`SELECT * FROM comment_rules WHERE id = ?`)
      .bind(id)
      .first<CommentRuleRow>();

    if (!row) return c.json({ success: false, error: 'Comment rule not found' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('PUT /api/comment-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/comment-rules/:id - delete
commentRules.delete('/api/comment-rules/:id', async (c) => {
  try {
    await c.env.DB
      .prepare(`DELETE FROM comment_rules WHERE id = ?`)
      .bind(c.req.param('id')!)
      .run();
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/comment-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── B-18: comment auto-hide (NG words / spam) ──

commentRules.get('/api/comment-moderation', requireRole('owner', 'admin'), async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  return c.json({ success: true, data: { settings: await loadModerationSettings(c.env.DB, account.id), hidden: await loadHiddenComments(c.env.DB, account.id) } });
});

commentRules.put('/api/comment-moderation', requireRole('owner'), async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = parseModerationSettings(body);
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400);
  await saveModerationSettings(c.env.DB, account.id, parsed);
  return c.json({ success: true, data: parsed });
});

commentRules.post('/api/comment-moderation/unhide', requireRole('owner'), async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const body = await c.req.json().catch(() => null) as { commentId?: unknown } | null;
  if (!body || typeof body.commentId !== 'string' || !body.commentId.trim()) {
    return c.json({ success: false, error: 'commentId is required' }, 400);
  }
  const client = await getAccountClient(c.env, c.env.DB, account);
  const result = await unhideComment(c.env.DB, client, account.id, body.commentId.trim());
  if (!result.ok) return c.json({ success: false, error: result.error ?? 'unhide failed' }, 502);
  return c.json({ success: true, data: { commentId: body.commentId.trim() } });
});

export { commentRules };
