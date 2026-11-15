/**
 * B-08/B-09: app-side webhook subscription check & fix.
 * Mocks the graph.facebook.com subscriptions endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAppWebhook, fixAppWebhook, resolveAppId } from '../app-webhook.js';
import { saveTokenDebug } from '../token-debug.js';

const account = { id: 'acc1', ig_user_id: '111', app_secret: 'enc:v1:test' as string | null };

function env(overrides: Partial<{ IG_APP_ID?: string; IG_APP_SECRET?: string; WORKER_URL: string }> = {}) {
  return { IG_APP_ID: '999888', IG_APP_SECRET: 'app-secret', WORKER_URL: 'https://w.example', ...overrides };
}

function dbWithDebug() {
  const settings = new Map<string, string>();
  const stmt = (sql: string, params: unknown[]) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    first: async <T,>() => (sql.includes('WHERE key = ?') && settings.has(String(params[0])) ? ({ value: settings.get(String(params[0])) } as T) : (null as T)),
    run: async () => {
      if (sql.includes('INTO integration_settings')) settings.set(String(params[0]), String(params[1]));
      return { meta: {} };
    },
  });
  return { settings, db: { prepare: (sql: string) => stmt(sql, []) } as unknown as D1Database };
}

function subscriptionsResponse(objects: unknown[]): Response {
  return new Response(JSON.stringify({ data: objects }), { status: 200 });
}

describe('checkAppWebhook (B-08)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('ok when the instagram object is fully subscribed to our callback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => subscriptionsResponse([
      { object: 'instagram', callback_url: 'https://w.example/webhook', fields: [
        { name: 'messages' }, { name: 'messaging_postbacks' }, { name: 'messaging_referral' },
        { name: 'comments' }, { name: 'mentions' }, { name: 'live_comments' },
      ] },
    ])));
    const { db } = dbWithDebug();
    const report = await checkAppWebhook(env(), db, account);
    expect(report.status).toBe('ok');
    expect(report.callbackMatches).toBe(true);
    expect(report.missingFields).toEqual([]);
    expect(report.appId).toBe('999888');
  });

  it('fail when fields are missing or the callback differs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => subscriptionsResponse([
      { object: 'instagram', callback_url: 'https://w.example/webhook', fields: [{ name: 'messages' }] },
    ])));
    const { db } = dbWithDebug();
    const report = await checkAppWebhook(env(), db, account);
    expect(report.status).toBe('fail');
    expect(report.missingFields).toContain('comments');

    vi.stubGlobal('fetch', vi.fn(async () => subscriptionsResponse([
      { object: 'instagram', callback_url: 'https://someone-else.example/webhook', fields: [] },
    ])));
    const report2 = await checkAppWebhook(env(), db, account);
    expect(report2.status).toBe('fail');
    expect(report2.callbackMatches).toBe(false);
  });

  it('unknown when no app id / secret is available', async () => {
    const { db } = dbWithDebug();
    const report = await checkAppWebhook({ ...env(), IG_APP_ID: undefined, IG_APP_SECRET: undefined }, db, { ...account, app_secret: null });
    expect(report.status).toBe('unknown');
    expect(report.appId).toBeNull();
  });
});

describe('fixAppWebhook (B-09)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('posts the subscription and generates a verify token when unset', async () => {
    const posts: Array<{ body: Record<string, unknown>; url: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'POST' && init?.body) {
        posts.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, url });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return subscriptionsResponse([]);
    }));
    const { db } = dbWithDebug();
    let savedToken = '';
    const result = await fixAppWebhook(env(), db, account, {
      updateAccountVerifyToken: async (t) => { savedToken = t; },
    });
    expect(result.fixed).toBe(true);
    expect(savedToken).toMatch(/^[0-9a-f]{48}$/);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.object).toBe('instagram');
    expect(posts[0]!.body.verify_token).toBe(savedToken);
    expect(posts[0]!.body.callback_url).toBe('https://w.example/webhook');
    expect(String(posts[0]!.body.fields)).toContain('comments');
  });

  it('refuses to overwrite a foreign callback URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => subscriptionsResponse([
      { object: 'instagram', callback_url: 'https://other-app.example/webhook', fields: [] },
    ])));
    const { db } = dbWithDebug();
    const result = await fixAppWebhook(env(), db, account, { updateAccountVerifyToken: async () => {} });
    expect(result.fixed).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.foreignUrl).toBe('https://other-app.example/webhook');
  });

  it('app_id can come from the debug_token result when IG_APP_ID is unset', async () => {
    const { db, settings } = dbWithDebug();
    await saveTokenDebug(db, 'acc1', { checkedAt: new Date().toISOString(), status: 'ok', appId: '555444' });
    expect(await resolveAppId({ IG_APP_SECRET: 's' } as never, db, 'acc1')).toBe('555444');
    expect(settings.get('health:token_debug:acc1')).toBeTruthy();
  });
});
