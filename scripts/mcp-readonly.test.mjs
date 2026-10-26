import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
async function listTools(readOnly) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../packages/mcp-server/dist/index.js', import.meta.url))], {
      env: { ...process.env, IG_HARNESS_API_URL: 'https://example.invalid', IG_HARNESS_API_KEY: 'test-only', IG_HARNESS_READ_ONLY: String(readOnly) }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('MCP handshake timed out')); }, 10_000);
    const finish = (error, result) => { clearTimeout(timer); child.kill(); error ? reject(error) : resolve(result); };
    const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
    let buffer = '';
    child.on('error', (e) => finish(e));
    child.on('exit', (code) => { if (code) finish(new Error(`MCP exited ${code}`)); });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        const response = JSON.parse(line);
        if (response.error) { finish(new Error('MCP returned an error')); return; }
        if (response.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (response.id === 2) finish(null, response.result.tools.map((tool) => tool.name));
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'review-test', version: '1' } } });
  });
}
test('read-only MCP exposes only read tools, omitting all mixed/write tools', async () => {
  const read = await listTools(true);
  assert.equal(read.length, 7);
  assert.ok(read.every((name) => /^(list_|get_|account_summary$)/.test(name)));
  const full = await listTools(false);
  assert.ok(full.includes('broadcast')); assert.ok(full.includes('send_dm'));
  assert.ok(full.length > read.length);
});
