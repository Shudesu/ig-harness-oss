import * as p from '@clack/prompts';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
interface McpConfigOptions { workerUrl: string; apiKey: string; repoDir: string }
export async function generateMcpConfig(options: McpConfigOptions): Promise<void> {
  const binary = join(options.repoDir, 'packages/mcp-server/dist/index.js');
  if (!existsSync(binary)) await execa('pnpm', ['--filter', '@ig-harness/sdk', '--filter', '@ig-harness/mcp-server', 'build'], { cwd: options.repoDir });
  const file = join(options.repoDir, '.mcp.json');
  let config: Record<string, any> = {};
  if (existsSync(file)) {
    try { config = JSON.parse(readFileSync(file, 'utf8')); }
    catch { throw new Error(`Invalid JSON in ${file}; preserve and repair it before retrying. Nothing was overwritten.`); }
    if (!config || Array.isArray(config) || typeof config !== 'object' || (config.mcpServers && (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)))) throw new Error(`Invalid MCP configuration in ${file}; nothing was overwritten.`);
    writeFileSync(`${file}.backup`, readFileSync(file), { mode: 0o600 });
    chmodSync(`${file}.backup`, 0o600);
  }
  config.mcpServers ??= {};
  config.mcpServers['ig-harness'] = { command: 'node', args: [binary], env: { IG_HARNESS_API_URL: options.workerUrl, IG_HARNESS_API_KEY: options.apiKey } };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }); chmodSync(file, 0o600);
  // Generate a private snippet; never overwrite another application's global
  // configuration or print the credential into terminal history.
  const snippet = join(options.repoDir, '.ig-harness-mcp-clients.json');
  writeFileSync(snippet, JSON.stringify({ mcpServers: { 'ig-harness': config.mcpServers['ig-harness'] } }, null, 2) + '\n', { mode: 0o600 }); chmodSync(snippet, 0o600);
  p.log.success(`Claude Code project config: ${file}\nCursor (.cursor/mcp.json) / Claude Desktop (claude_desktop_config.json) 用スニペット: ${snippet}\n既存の mcpServers に統合してください。管理者キーでは送信・設定変更が可能です。読み取り専用には IG_HARNESS_READ_ONLY=true を設定してください。`);
}
