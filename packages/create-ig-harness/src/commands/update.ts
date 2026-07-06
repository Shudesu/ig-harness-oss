import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { ensureAuth } from "../steps/auth.js";
import { setAccountId, wrangler } from "../lib/wrangler.js";
import { deployWorker } from "../steps/deploy-worker.js";
import { join } from "node:path";
import { execa } from "execa";

interface DeployedState {
  apiKey?: string;
  workerUrl?: string;
  adminUrl?: string;
  workerName?: string;
  d1DatabaseId?: string;
  d1DatabaseName?: string;
  accountId?: string;
}

function loadDeployedState(repoDir: string): DeployedState | null {
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

  const deployedState = loadDeployedState(repoDir);
  if (!deployedState) {
    p.log.warn(
      [
        ".ig-harness-deployed.json が見つかりません。",
        "初回セットアップ済みの repo で `create-ig-harness update --repo-dir <path>` を実行するか、",
        "~/.ig-harness/.ig-harness-deployed.json に deployed state を配置してください。",
      ].join("\n"),
    );
  }
  if (deployedState?.accountId) setAccountId(deployedState.accountId);
  const s = p.spinner();

  // Run pending migrations against the user's actual D1 (use saved name)
  const dbName = deployedState?.d1DatabaseName ?? "ig-harness";
  s.start("マイグレーション確認中...");
  try {
    await wrangler(
      ["d1", "migrations", "apply", dbName, "--remote"],
      { cwd: join(repoDir, "packages/db") },
    );
    s.stop("マイグレーション完了");
  } catch {
    s.stop("マイグレーション完了（変更なし）");
  }

  // Redeploy Worker. The committed wrangler.toml is a TEMPLATE with our dev
  // bindings, so we MUST overwrite it with the user's saved D1/R2/account
  // bindings before deploying. Falls back to a plain `wrangler deploy` only
  // when no deployed state is available (legacy installs from before this
  // file was written).
  s.start("Worker 再デプロイ中...");
  if (
    deployedState?.workerName &&
    deployedState?.d1DatabaseId &&
    deployedState?.d1DatabaseName &&
    deployedState?.accountId
  ) {
    await deployWorker({
      repoDir,
      d1DatabaseId: deployedState.d1DatabaseId,
      d1DatabaseName: deployedState.d1DatabaseName,
      workerName: deployedState.workerName,
      accountId: deployedState.accountId,
    });
  } else {
    await wrangler(["deploy"], { cwd: join(repoDir, "apps/worker") });
  }
  s.stop("Worker 再デプロイ完了");

  // Rebuild and redeploy Admin UI
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
