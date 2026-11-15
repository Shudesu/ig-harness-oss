import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// Fake IG Harness API: records requests, never talks to Instagram.
function fakeApi() {
  const requests = [];
  const accounts = [
    { id: 'default', igUserId: '111', username: 'main_shop', accessToken: '****aaaa', isActive: true, isDefault: true, connection: null },
    { id: 'second', igUserId: '222', username: 'second_shop', accessToken: '****bbbb', isActive: true, isDefault: false, connection: null },
  ];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization });
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (url.pathname === '/api/accounts' && req.method === 'GET') return send(200, { success: true, data: accounts });
      if (url.pathname === '/api/accounts' && req.method === 'POST') return send(201, { success: true, data: { id: 'third', igUserId: '333', username: 'new_shop', accessToken: `****${body.accessToken.slice(-4)}`, isActive: true, isDefault: false, connection: { ok: true } } });
      if (url.pathname === '/api/accounts/second' && req.method === 'PATCH') return send(200, { success: true, data: { ...accounts[1], isActive: body.isActive } });
      if (url.pathname === '/api/tags') return send(200, { success: true, data: [] });
      send(404, { success: false, error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

function mcp(apiUrl) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../packages/mcp-server/dist/index.js', import.meta.url))], {
    env: { ...process.env, IG_HARNESS_API_URL: apiUrl, IG_HARNESS_API_KEY: 'test-only', IG_HARNESS_READ_ONLY: 'false', IG_HARNESS_ACCOUNT_ID: '' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = ''; let nextId = 1; const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk; let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
      pending.get(msg.id)?.(msg); pending.delete(msg.id);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++; const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 10_000);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(m.error.message)) : resolve(m.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); return { ...JSON.parse(r.content[0].text), isError: Boolean(r.isError) }; };
  return { child, rpc, call };
}

test('MCP account tools: list, approval-gated add/remove, switch scopes later calls, tokens masked', async () => {
  const api = await fakeApi();
  const m = mcp(api.url);
  try {
    await m.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    m.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = (await m.rpc('tools/list', {})).tools.map((t) => t.name);
    for (const name of ['list_accounts', 'add_account', 'switch_account', 'remove_account', 'check_account_connection']) assert.ok(tools.includes(name), name);

    const listed = await m.call('list_accounts');
    assert.equal(listed.accounts.length, 2);
    assert.equal(listed.activeAccountId, 'default');

    // add without approval: preview only, no API call, token masked
    const before = api.requests.length;
    const preview = await m.call('add_account', { accessToken: 'IGAA-super-secret-token-9876' });
    assert.equal(preview.requiresApproval, true);
    assert.equal(api.requests.length, before);
    assert.ok(!JSON.stringify(preview).includes('super-secret'));
    assert.equal(preview.preview.accessToken, '****9876');

    const added = await m.call('add_account', { accessToken: 'IGAA-super-secret-token-9876', confirm: true });
    assert.equal(added.success, true);
    assert.ok(!JSON.stringify(added).includes('super-secret'));
    const post = api.requests.find((r) => r.method === 'POST' && r.path === '/api/accounts');
    assert.equal(post.body.subscribeWebhooks, true);

    // switch: later tool calls are scoped with ?account_id=second
    assert.equal((await m.call('switch_account', { accountId: 'second' })).activeAccountId, 'second');
    await m.call('manage_tags', { action: 'list' });
    const tagCall = api.requests.filter((r) => r.path === '/api/tags').at(-1);
    assert.equal(tagCall.query.account_id, 'second');
    assert.equal((await m.call('switch_account', { accountId: 'nope' })).isError, true);

    // remove: default refused, approval required, then PATCH isActive=false
    assert.equal((await m.call('remove_account', { accountId: 'default', confirm: true })).isError, true);
    const removePreview = await m.call('remove_account', { accountId: 'second' });
    assert.equal(removePreview.requiresApproval, true);
    assert.ok(!api.requests.some((r) => r.method === 'PATCH'));
    const removed = await m.call('remove_account', { accountId: 'second', confirm: true });
    assert.equal(removed.account.isActive, false);
    assert.deepEqual(api.requests.find((r) => r.method === 'PATCH').body, { isActive: false });
    assert.equal((await m.call('list_accounts')).activeAccountId, 'default');
  } finally { m.child.kill(); api.server.close(); }
});
