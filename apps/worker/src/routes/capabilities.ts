import { Hono } from 'hono';
import type { Env } from '../index.js';

export const IG_CAPABILITIES = {
  product: 'ig-harness',
  platform: 'instagram',
  version: '0.5.3',
  connectorVersion: '2026-05-20',
  identity: {
    primaryUserKey: 'ig_igsid',
    supportedLinks: ['line_friend_id'],
  },
  features: [
    'comments-to-dm',
    'comment-auto-reply',
    'engagement-gates',
    'follow-check',
    'line-cross-link',
    'tracked-links',
    'forms',
    'broadcasts',
    'rich-messages',
    'step-delivery',
    'mcp',
  ],
  endpoints: {
    health: '/api/health',
    staffMe: '/api/staff/me',
    lineConnections: '/api/line-connections',
    trackedLinks: '/api/tracked-links',
    identityLink: '/api/followers/link-line',
  },
} as const;

export const capabilities = new Hono<Env>();

capabilities.get('/api/capabilities', (c) => {
  return c.json({ success: true, data: IG_CAPABILITIES });
});
