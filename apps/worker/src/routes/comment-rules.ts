import { Hono } from 'hono';
import { jstNow } from '@ig-harness/db';
import type { Env } from '../index.js';

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
  is_active: number;
  created_at: string;
  updated_at: string;
}

function serialize(row: CommentRuleRow) {
  return {
    id: row.id,
    name: row.name,
    triggerType: row.trigger_type,
    mediaId: row.media_id,
    keyword: row.keyword,
    matchType: row.match_type,
    responseType: row.response_type,
    responseBody: JSON.parse(row.response_body),
    delaySeconds: row.delay_seconds,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/comment-rules - list all
commentRules.get('/api/comment-rules', async (c) => {
  try {
    const result = await c.env.DB
      .prepare(`SELECT * FROM comment_rules ORDER BY created_at DESC`)
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
    const body = await c.req.json<{
      name: string;
      triggerType?: string;
      mediaId?: string;
      keyword?: string;
      matchType?: string;
      responseType: string;
      responseBody: Record<string, unknown>;
      delaySeconds?: number;
    }>();

    if (!body.name || !body.responseType || !body.responseBody) {
      return c.json(
        { success: false, error: 'name, responseType, and responseBody are required' },
        400,
      );
    }

    const id = crypto.randomUUID();
    const now = jstNow();

    await c.env.DB
      .prepare(
        `INSERT INTO comment_rules (id, name, trigger_type, media_id, keyword, match_type, response_type, response_body, delay_seconds, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        body.name,
        body.triggerType || 'comment',
        body.mediaId || null,
        body.keyword || null,
        body.matchType || 'contains',
        body.responseType,
        JSON.stringify(body.responseBody),
        body.delaySeconds || 0,
        now,
        now,
      )
      .run();

    const row = await c.env.DB
      .prepare(`SELECT * FROM comment_rules WHERE id = ?`)
      .bind(id)
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
    }>();

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

export { commentRules };
