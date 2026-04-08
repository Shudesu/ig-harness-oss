import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { ensureAuth } from "../steps/auth.js";
import { wrangler } from "../lib/wrangler.js";
import { join } from "node:path";
import { execa } from "execa";

interface SetupState {
  apiKey?: string;
  workerUrl?: string;
  adminUrl?: string;
  completedSteps: string[];
}

function loadSetupState(repoDir: string): SetupState | null {
  // After a successful setup the state file is deleted, so we look for a
  // persisted "deployed" state alongside the repo instead.
  const path = join(repoDir, ".ig-harness-deployed.json");
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

export async function runUpdate(repoDir: string): Promise<void> {
  p.intro(pc.bgMagenta(pc.black(" Instagram Harness アップデート ")));

  await ensureAuth();

  const s = p.spinner();

  // Run pending migrations
  s.start("マイグレーション確認中...");
  try {
    await wrangler(
      ["d1", "migrations", "apply", "ig-harness", "--remote"],
      { cwd: join(repoDir, "packages/db") },
    );
    s.stop("マイグレーション完了");
  } catch {
    s.stop("マイグレーション完了（変更なし）");
  }

  // Redeploy Worker (uses the committed wrangler.toml which should have correct IDs)
  s.start("Worker 再デプロイ中...");
  await wrangler(["deploy"], { cwd: join(repoDir, "apps/worker") });
  s.stop("Worker 再デプロイ完了");

  // Rebuild and redeploy Admin UI
  // Read the admin project name from the deployed state if available
  const deployedState = loadSetupState(repoDir);
  const webDir = join(repoDir, "apps/web");

  s.start("Admin UI 再デプロイ中...");
  await execa("pnpm", ["run", "build"], { cwd: webDir });

  // Attempt to list Pages projects and find the ih-admin-* project
  let adminProjectName = "ig-harness-admin";
  if (deployedState?.apiKey) {
    adminProjectName = `ih-admin-${deployedState.apiKey.slice(0, 8)}`;
  } else {
    try {
      const projectList = await wrangler(["pages", "project", "list"]);
      const match = projectList.match(/ih-admin-[a-f0-9]{8}/);
      if (match) {
        adminProjectName = match[0];
      }
    } catch {
      // Fall back to default
    }
  }

  await wrangler(
    ["pages", "deploy", "out", "--project-name", adminProjectName, "--commit-dirty=true"],
    { cwd: webDir },
  );
  s.stop(`Admin UI 再デプロイ完了 (${adminProjectName})`);

  p.outro(pc.green("アップデート完了！"));
}
