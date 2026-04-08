import { Hono } from 'hono';
import {
  getBroadcasts,
  getBroadcastById,
  createBroadcast,
  updateBroadcast,
  deleteBroadcast,
} from '@ig-harness/db';
import type { Broadcast as DbBroadcast, BroadcastMessageType } from '@ig-harness/db';
import { InstagramClient } from '@ig-harness/ig-sdk';
import { processBroadcastSend } from '../services/broadcast.js';
import type { Env } from '../index.js';

const broadcasts = new Hono<Env>();

function serializeBroadcast(row: DbBroadcast) {
  return {
    id: row.id,
    name: row.name,
    messageType: row.message_type,
    body: row.body,
    tagFilter: row.tag_filter,
    status: row.status,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    totalSent: row.total_sent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/broadcasts - list all
broadcasts.get('/api/broadcasts', async (c) => {
  try {
    const items = await getBroadcasts(c.env.DB);
    return c.json({ success: true, data: items.map(serializeBroadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id - get single
broadcasts.get('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);

    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    return c.json({ success: true, data: serializeBroadcast(broadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts - create
broadcasts.post('/api/broadcasts', async (c) => {
  try {
    const reqBody = await c.req.json<{
      name: string;
      messageType: BroadcastMessageType;
      body: string;
      tagFilter?: string | null;
      scheduledAt?: string | null;
    }>();

    if (!reqBody.name || !reqBody.messageType || !reqBody.body) {
      return c.json(
        { success: false, error: 'name, messageType, and body are required' },
        400,
      );
    }

    const broadcast = await createBroadcast(c.env.DB, {
      name: reqBody.name,
      messageType: reqBody.messageType,
      body: reqBody.body,
      tagFilter: reqBody.tagFilter ?? null,
      scheduledAt: reqBody.scheduledAt ?? null,
    });

    return c.json({ success: true, data: serializeBroadcast(broadcast) }, 201);
  } catch (err) {
    console.error('POST /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/broadcasts/:id - update draft
broadcasts.put('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status !== 'draft' && existing.status !== 'scheduled') {
      return c.json({ success: false, error: 'Only draft or scheduled broadcasts can be updated' }, 400);
    }

    const reqBody = await c.req.json<{
      name?: string;
      messageType?: BroadcastMessageType;
      body?: string;
      tagFilter?: string | null;
      scheduledAt?: string | null;
    }>();

    // Keep status in sync with scheduledAt changes
    let statusUpdate: 'draft' | 'scheduled' | undefined;
    if (reqBody.scheduledAt !== undefined) {
      statusUpdate = reqBody.scheduledAt ? 'scheduled' : 'draft';
    }

    const updated = await updateBroadcast(c.env.DB, id, {
      name: reqBody.name,
      message_type: reqBody.messageType,
      body: reqBody.body,
      tag_filter: reqBody.tagFilter,
      scheduled_at: reqBody.scheduledAt,
      ...(statusUpdate !== undefined ? { status: statusUpdate } : {}),
    });

    return c.json({ success: true, data: updated ? serializeBroadcast(updated) : null });
  } catch (err) {
    console.error('PUT /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/broadcasts/:id - delete
broadcasts.delete('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteBroadcast(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/send - send now
broadcasts.post('/api/broadcasts/:id/send', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status === 'sending' || existing.status === 'sent') {
      return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 400);
    }

    const igClient = new InstagramClient({ accessToken: c.env.IG_ACCESS_TOKEN, igUserId: c.env.IG_USER_ID });
    await processBroadcastSend(c.env.DB, igClient, existing.id, c.env.WORKER_URL);

    const result = await getBroadcastById(c.env.DB, existing.id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { broadcasts };
