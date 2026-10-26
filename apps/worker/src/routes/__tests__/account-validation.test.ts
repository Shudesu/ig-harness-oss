import { it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { accounts } from '../accounts.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
import { graphObserver, assertGraphAvailable } from '../../lib/graph-observation.js';
import { getHealthSnapshot } from '../../lib/health.js';
afterEach(() => vi.unstubAllGlobals());
async function fixture() { const f = await gateFixture(); const app = new Hono<any>(); app.use('*', async (c, next) => { c.set('staff', { id: 'owner', name: 'Owner', role: 'owner' }); await next(); }); app.route('/', accounts); const env: any = { DB: f.db, IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test', IG_APP_SECRET: 'secret', TOKEN_ENCRYPTION_KEY: btoa('01234567890123456789012345678901') }; return { ...f, request: (path: string, method: string, body: unknown) => app.request('https://worker.example' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env) }; }
it('rejects an invalid token without persisting an account', async () => { const f = await fixture(); try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":190}}', { status: 401 })));
    const response = await f.request('/api/accounts', 'POST', { igUserId: '222', accessToken: 'invalid' });
    expect(response.status).toBe(400);
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM ig_accounts').get()?.n).toBe(1);
}
finally {
    f.sqlite.close();
} });
it('rejects a token for another user_id and preserves credentials on failed replacement', async () => { const f = await fixture(); try {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"user_id":"999","username":"someone"}')));
    expect((await f.request('/api/accounts', 'POST', { igUserId: '222', accessToken: 'wrong-account' })).status).toBe(400);
    expect((await f.request('/api/accounts/a', 'PATCH', { accessToken: 'wrong-account' })).status).toBe(400);
    expect(f.sqlite.prepare("SELECT access_token FROM ig_accounts WHERE id='a'").get()?.access_token).toBe('test');
}
finally {
    f.sqlite.close();
} });
it('saves only after validation, uses the authoritative username and encrypts the token', async () => { const f = await fixture(); try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"user_id":"222","username":"verified_user"}')));
    const response = await f.request('/api/accounts', 'POST', { accessToken: 'not-prefix-validated', username: 'unverified' });
    expect(response.status).toBe(201);
    const row = f.sqlite.prepare("SELECT username,access_token FROM ig_accounts WHERE ig_user_id='222'").get();
    expect(row?.username).toBe('verified_user');
    expect(row?.access_token).toMatch(/^enc:v1:/);
    expect(await response.text()).not.toContain('not-prefix-validated');
}
finally {
    f.sqlite.close();
} });
it('records revocation and throttling immediately in account health', async () => { const f = await fixture(); try {
    const observe = graphObserver(f.db, 'a');
    await observe({ status: 401, code: 190, usage: { call_count: 75 } });
    await observe({ status: 429, code: 613, retryAfterMs: 120000, usage: { call_count: 95 } });
    await expect(assertGraphAvailable(f.db, 'a')).rejects.toMatchObject({ status: 429 });
    const health = await getHealthSnapshot(f.db);
    expect(health.accounts[0]).toMatchObject({ token_api_ok: false, graph_usage: { call_count: 95 } });
    expect(health.accounts[0]?.graph_backoff_until).toBeTruthy();
}
finally {
    f.sqlite.close();
} });
it('stops further calls in the same client after Meta throttles a request', async () => { const f = await fixture(); try {
    f.sqlite.prepare("UPDATE ig_accounts SET token_expires_at=? WHERE id='a'").run(Math.floor(Date.now() / 1000) + 60 * 86400);
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":{"code":613}}', { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    const { getAccountClient } = await import('../../lib/accounts.js');
    const account = f.sqlite.prepare("SELECT * FROM ig_accounts WHERE id='a'").get();
    const client = await getAccountClient({ IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test' }, f.db, account as any);
    await expect(client.sendText('user', 'first')).rejects.toMatchObject({ code: 613 });
    await expect(client.sendText('user', 'second')).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledOnce();
}
finally {
    f.sqlite.close();
} });
