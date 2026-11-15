import { it, expect, vi, afterEach, describe } from 'vitest';
import { Hono } from 'hono';
import { accounts } from '../accounts.js';
import { commentRules } from '../comment-rules.js';
import { deliveryStatus } from '../delivery-status.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
import { checkAccountConnection, WEBHOOK_FIELDS } from '../../lib/account-connection.js';
import { getHealthSnapshot } from '../../lib/health.js';
import { InstagramApiError } from '@ig-harness/ig-sdk';

afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; url: URL };
/** Fake graph.instagram.com keyed by path; records every call. */
function fakeGraph(opts: { subscribed?: string[]; conversationsError?: { code: number }; commentsError?: { code: number }; media?: boolean } = {}) {
  const calls: Call[] = [];
  let subscribed = opts.subscribed ?? [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input); const method = init?.method ?? 'GET';
    calls.push({ method, url });
    const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === '/me' ) return json({ user_id: '222', username: 'new_shop', id: '222' });
    if (path === '/222/subscribed_apps' && method === 'POST') { subscribed = (url.searchParams.get('subscribed_fields') ?? '').split(','); return json({ success: true }); }
    if (path === '/222/subscribed_apps') return json({ data: [{ subscribed_fields: subscribed }] });
    if (path === '/me/conversations') return opts.conversationsError ? json({ error: { ...opts.conversationsError, message: '(#200) Requires instagram_business_manage_messages permission' } }, 403) : json({ data: [] });
    if (path === '/222/media') return json({ data: opts.media === false ? [] : [{ id: 'm1' }] });
    if (path === '/m1/comments') return opts.commentsError ? json({ error: { ...opts.commentsError, message: '(#10) Application does not have permission for this action' } }, 400) : json({ data: [] });
    return json({ error: { code: 100, message: 'unexpected path ' + path } }, 400);
  });
  return { fetch, calls };
}

async function fixture(role: 'owner' | 'admin' = 'owner') {
  const f = await gateFixture();
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('staff', { id: 's', name: 'S', role }); await next(); });
  app.route('/', accounts); app.route('/', commentRules); app.route('/', deliveryStatus);
  const env: any = { DB: f.db, IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test', IG_APP_SECRET: 'secret', TOKEN_ENCRYPTION_KEY: btoa('01234567890123456789012345678901') };
  const request = (path: string, method = 'GET', body?: unknown) => app.request('https://worker.example' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { ...f, request };
}

describe('account add: webhook subscription + permission check', () => {
  it('subscribes the new account (subscribed_apps) and returns a passing report', async () => {
    const f = await fixture();
    try {
      const g = fakeGraph();
      vi.stubGlobal('fetch', g.fetch);
      const res = await f.request('/api/accounts', 'POST', { accessToken: 'tok-new' });
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      const post = g.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/222/subscribed_apps'));
      expect(post?.url.searchParams.get('subscribed_fields')).toBe(WEBHOOK_FIELDS.join(','));
      expect(body.data.connection).toMatchObject({ ok: true, webhook: { state: 'ok', subscribedNow: true, missingFields: [] }, permissions: { messages: { state: 'ok' }, comments: { state: 'ok' } } });
      expect(JSON.stringify(body)).not.toContain('tok-new');
      // persisted and surfaced in list + health
      const list = await (await f.request('/api/accounts')).json() as any;
      expect(list.data.find((a: any) => a.igUserId === '222').connection.ok).toBe(true);
      const health = await getHealthSnapshot(f.db);
      expect(health.accounts.find((a) => a.username === 'new_shop')?.connection?.ok).toBe(true);
    } finally { f.sqlite.close(); }
  });

  it('can skip the subscription and reports missing permissions without failing the add', async () => {
    const f = await fixture();
    try {
      const g = fakeGraph({ conversationsError: { code: 200 }, commentsError: { code: 10 } });
      vi.stubGlobal('fetch', g.fetch);
      const res = await f.request('/api/accounts', 'POST', { accessToken: 'tok-new', subscribeWebhooks: false });
      expect(res.status).toBe(201);
      const { data } = await res.json() as any;
      expect(g.calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/subscribed_apps'))).toBe(false);
      expect(data.connection.ok).toBe(false);
      expect(data.connection.webhook).toMatchObject({ state: 'missing', missingFields: [...WEBHOOK_FIELDS] });
      expect(data.connection.permissions.messages).toMatchObject({ state: 'missing', message: expect.stringContaining('instagram_business_manage_messages') });
      expect(data.connection.permissions.comments.state).toBe('missing');
      const accountId = data.id;
      const failures = await (await f.request(`/api/delivery-failures?account_id=${accountId}`)).json() as any;
      expect(failures.data[0]).toMatchObject({ source: 'account_setup' });
    } finally { f.sqlite.close(); }
  });

  it('re-check endpoint can re-subscribe and requires the owner role', async () => {
    const f = await fixture();
    try {
      vi.stubGlobal('fetch', fakeGraph().fetch);
      const { data } = await (await f.request('/api/accounts', 'POST', { accessToken: 'tok-new', subscribeWebhooks: false })).json() as any;
      const g2 = fakeGraph();
      vi.stubGlobal('fetch', g2.fetch);
      const res = await f.request(`/api/accounts/${data.id}/connection-check`, 'POST', { subscribe: true });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data.webhook.state).toBe('ok');
      expect((await (await f.request(`/api/accounts/${data.id}/connection`)).json() as any).data.ok).toBe(true);
    } finally { f.sqlite.close(); }
    const a = await fixture('admin');
    try {
      expect((await a.request('/api/accounts/a/connection-check', 'POST', { subscribe: true })).status).toBe(403);
    } finally { a.sqlite.close(); }
  });
});

describe('checkAccountConnection', () => {
  it('stops early on an invalid token and marks comments skipped when there is no media', async () => {
    const expired = await checkAccountConnection({ getMe: vi.fn().mockRejectedValue(new InstagramApiError('x', 401, 190)) } as any, { subscribe: true });
    expect(expired.ok).toBe(false);
    expect(expired.profile.message).toContain('トークン');
    const client: any = { getMe: vi.fn(async () => ({ username: 'u' })), subscribeApp: vi.fn(), getSubscribedFields: vi.fn(async () => [...WEBHOOK_FIELDS]), probeConversations: vi.fn(), getMyMedia: vi.fn(async () => []), probeMediaComments: vi.fn() };
    const report = await checkAccountConnection(client, { subscribe: false });
    expect(client.subscribeApp).not.toHaveBeenCalled();
    expect(report.permissions.comments.state).toBe('skipped');
    expect(report.ok).toBe(true);
  });
});

describe('comment rule API separates DM body and public reply', () => {
  it('stores replyText/replyMode (and the legacy replyComment alias)', async () => {
    const f = await fixture();
    try {
      const created = await f.request('/api/comment-rules?account_id=a', 'POST', { name: 'r', keyword: 'guide', responseType: 'text', responseBody: { text: 'DM本文' }, replyText: '返信しました', replyMode: 'mention' });
      expect(created.status).toBe(201);
      const rule = (await created.json() as any).data;
      expect(rule).toMatchObject({ responseBody: { text: 'DM本文' }, replyText: '返信しました', replyMode: 'mention' });
      const updated = await (await f.request(`/api/comment-rules/${rule.id}`, 'PUT', { replyComment: '' })).json() as any;
      expect(updated.data).toMatchObject({ replyText: '', replyMode: 'mention' });
      expect((await f.request(`/api/comment-rules/${rule.id}`, 'PUT', { replyMode: 'top' })).status).toBe(400);
    } finally { f.sqlite.close(); }
  });
});
