import * as p from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface McpConfigOptions {
  workerUrl: string;
  apiKey: string;
  /** Absolute path to the cloned ig-harness repo. Used to resolve the MCP server binary. */
  repoDir: string;
}

export function generateMcpConfig(options: McpConfigOptions): void {
  const mcpJsonPath = join(process.cwd(), ".mcp.json");

  // Use the absolute path to the MCP server binary so the config works
  // regardless of where the .mcp.json file lives relative to the repo.
  const mcpServerPath = join(options.repoDir, "packages/mcp-server/dist/index.js");

  const newServerConfig = {
    command: "node",
    args: [mcpServerPath],
    env: {
      INSTAGRAM_HARNESS_API_URL: options.workerUrl,
      INSTAGRAM_HARNESS_API_KEY: options.apiKey,
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
