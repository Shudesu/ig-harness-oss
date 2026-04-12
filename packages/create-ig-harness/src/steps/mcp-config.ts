import * as p from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

interface McpConfigOptions {
  workerUrl: string;
  apiKey: string;
  /** Absolute path to the cloned ig-harness repo. Used to resolve the MCP server binary. */
  repoDir: string;
}

export async function generateMcpConfig(options: McpConfigOptions): Promise<void> {
  const mcpJsonPath = join(process.cwd(), ".mcp.json");

  // Use the absolute path to the MCP server binary so the config works
  // regardless of where the .mcp.json file lives relative to the repo.
  const mcpServerPath = join(options.repoDir, "packages/mcp-server/dist/index.js");

  // dist/ is .gitignored, so a fresh clone has only `pnpm install`'d
  // dependencies. Build the MCP server (and its SDK dep) on demand so the
  // config we write actually points at a working binary.
  if (!existsSync(mcpServerPath)) {
    const s = p.spinner();
    s.start("MCP server をビルド中...");
    try {
      await execa(
        "pnpm",
        ["--filter", "@ig-harness/sdk", "--filter", "@ig-harness/mcp-server", "build"],
        { cwd: options.repoDir, stdio: "pipe" },
      );
      s.stop("MCP server ビルド完了");
    } catch (err) {
      s.stop("MCP server ビルド失敗");
      throw err;
    }
  }

  const newServerConfig = {
    command: "node",
    args: [mcpServerPath],
    env: {
      IG_HARNESS_API_URL: options.workerUrl,
      IG_HARNESS_API_KEY: options.apiKey,
    },
  };

  let mcpConfig: Record<string, any> = {};

  if (existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      // Invalid JSON, start fresh
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  // Don't overwrite existing ig-harness config — use a unique name
  let serverName = "ig-harness";
  if (mcpConfig.mcpServers["ig-harness"]) {
    // Extract a short suffix from the API key
    const suffix = options.apiKey.slice(0, 8);
    serverName = `ig-harness-${suffix}`;
    p.log.info(
      `既存の ig-harness 設定があるため、${serverName} として追加します`,
    );
  }
  mcpConfig.mcpServers[serverName] = newServerConfig;

  writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  p.log.success(`.mcp.json に MCP 設定を追加しました（${serverName}）`);
}
