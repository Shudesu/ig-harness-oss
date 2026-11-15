// B-19: ice breakers / persistent menu (messenger_profile edge) proxy.
// The Graph payload shape is passed through mostly as-is; validation keeps
// the payload bounded. GET/DELETE need no extra approval, writes are owner-only.
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { resolveAccount, getAccountClient } from '../lib/accounts.js';
import { requireRole } from '../middleware/role-guard.js';

const ALLOWED_FIELDS = ['ice_breakers', 'persistent_menu', 'greeting'];

export const messengerProfile = new Hono<Env>();

function readFields(raw: unknown): string | { error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'fields is required' };
  const fields = raw.split(',').map((f) => f.trim()).filter(Boolean);
  if (!fields.length || fields.some((f) => !ALLOWED_FIELDS.includes(f))) {
    return { error: `fields must be a comma-separated list of ${ALLOWED_FIELDS.join(', ')}` };
  }
  return fields.join(',');
}

function validatePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload object is required';
  const keys = Object.keys(payload as Record<string, unknown>);
  if (!keys.length) return 'payload must not be empty';
  if (keys.some((k) => !ALLOWED_FIELDS.includes(k))) return `payload keys must be one of ${ALLOWED_FIELDS.join(', ')}`;
  return null;
}

messengerProfile.get('/api/messenger-profile', requireRole('owner', 'admin'), async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const fields = readFields(c.req.query('fields'));
  if (typeof fields === 'object') return c.json({ success: false, error: fields.error }, 400);
  try {
    const client = await getAccountClient(c.env, c.env.DB, account);
    return c.json({ success: true, data: await client.getMessengerProfile(fields) });
  } catch (error) {
    if (error instanceof Error && /graph/i.test(error.message)) return c.json({ success: false, error: error.message }, 502);
    console.error('GET /api/messenger-profile error:', error instanceof Error ? error.name : 'unknown');
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

messengerProfile.post('/api/messenger-profile', requireRole('owner'), async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const payload = await c.req.json().catch(() => null);
  const invalid = validatePayload(payload);
  if (invalid) return c.json({ success: false, error: invalid }, 400);
  try {
    const client = await getAccountClient(c.env, c.env.DB, account);
    return c.json({ success: true, data: await client.setMessengerProfile(payload as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof Error && /graph/i.test(error.message)) return c.json({ success: false, error: error.message }, 502);
    console.error('POST /api/messenger-profile error:', error instanceof Error ? error.name : 'unknown');
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

messengerProfile.delete('/api/messenger-profile', requireRole('owner'), async (c) => {
  const account = await resolveAccount(c);
  if (!account) return c.json({ success: false, error: 'account not found' }, 404);
  const fields = readFields(c.req.query('fields'));
  if (typeof fields === 'object') return c.json({ success: false, error: fields.error }, 400);
  try {
    const client = await getAccountClient(c.env, c.env.DB, account);
    return c.json({ success: true, data: await client.deleteMessengerProfile(fields) });
  } catch (error) {
    if (error instanceof Error && /graph/i.test(error.message)) return c.json({ success: false, error: error.message }, 502);
    console.error('DELETE /api/messenger-profile error:', error instanceof Error ? error.name : 'unknown');
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
