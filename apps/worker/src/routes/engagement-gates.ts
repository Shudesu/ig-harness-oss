import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  createEngagementGate,
  listEngagementGates,
  getEngagementGate,
  updateEngagementGate,
  deleteEngagementGate,
  listGateDeliveries,
  getGateAnalytics,
} from '@ig-harness/db';

const engagementGates = new Hono<Env>();

engagementGates.get('/api/engagement-gates', async (c) => {
  const gates = await listEngagementGates(c.env.DB);
  return c.json({ success: true, data: gates });
});

engagementGates.post('/api/engagement-gates', async (c) => {
  const body = await c.req.json<{
    name: string;
    status?: 'active' | 'paused' | 'archived';
    trigger_type: 'comment_on_post' | 'dm_keyword' | 'story_mention';
    target_post_id?: string | null;
    trigger_keyword?: string | null;
    require_follow?: number;
    initial_dm_text: string;
    initial_dm_button_label?: string;
    follow_reminder_dm_text: string;
    follow_reminder_button_label?: string;
    reward_dm_text: string;
    reward_url?: string | null;
    max_loops?: number;
  }>();

  if (!body.name || !body.trigger_type || !body.initial_dm_text || !body.follow_reminder_dm_text || !body.reward_dm_text) {
    return c.json({ success: false, error: 'missing required fields' }, 400);
  }

  const gate = await createEngagementGate(c.env.DB, {
    name: body.name,
    status: body.status ?? 'active',
    trigger_type: body.trigger_type,
    target_post_id: body.target_post_id ?? null,
    trigger_keyword: body.trigger_keyword ?? null,
    require_follow: body.require_follow ?? 1,
    initial_dm_text: body.initial_dm_text,
    initial_dm_button_label: body.initial_dm_button_label ?? '特典を受け取る',
    follow_reminder_dm_text: body.follow_reminder_dm_text,
    follow_reminder_button_label: body.follow_reminder_button_label ?? 'フォローしたよ',
    reward_dm_text: body.reward_dm_text,
    reward_url: body.reward_url ?? null,
    max_loops: body.max_loops ?? 0,
  });
  return c.json({ success: true, data: gate });
});

engagementGates.get('/api/engagement-gates/:id', async (c) => {
  const id = c.req.param('id');
  const gate = await getEngagementGate(c.env.DB, id);
  if (!gate) return c.json({ success: false, error: 'not found' }, 404);
  const analytics = await getGateAnalytics(c.env.DB, id);
  return c.json({ success: true, data: { ...gate, analytics } });
});

engagementGates.patch('/api/engagement-gates/:id', async (c) => {
  const id = c.req.param('id');
  const patch = await c.req.json();
  await updateEngagementGate(c.env.DB, id, patch);
  const gate = await getEngagementGate(c.env.DB, id);
  return c.json({ success: true, data: gate });
});

engagementGates.delete('/api/engagement-gates/:id', async (c) => {
  const id = c.req.param('id');
  await deleteEngagementGate(c.env.DB, id);
  return c.json({ success: true });
});

engagementGates.get('/api/engagement-gates/:id/deliveries', async (c) => {
  const id = c.req.param('id');
  const deliveries = await listGateDeliveries(c.env.DB, id);
  return c.json({ success: true, data: deliveries });
});

export { engagementGates };
