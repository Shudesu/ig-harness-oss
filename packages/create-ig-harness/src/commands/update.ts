import { randomBytes } from "node:crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { ensureAuth } from "../steps/auth.js";
import { setAccountId, wrangler } from "../lib/wrangler.js";
import { backupDatabase } from "../steps/backup.js";
import { migrateDatabase } from "../steps/database.js";
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
  r2BucketName?: string;
  adminProjectName?: string;
  tokenEncryptionKey?: string;
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
  if (!deployedState?.d1DatabaseId || !deployedState.d1DatabaseName || !deployedState.accountId || !deployedState.workerName || !deployedState.r2BucketName) {
    throw new Error("保存済みの配信先情報がありません。.ig-harness-deployed.json を復元してください。接続先を推測して更新しません。");
  }
  if (deployedState?.accountId) setAccountId(deployedState.accountId);
  const s = p.spinner();

  // Run pending migrations against the user's actual D1 (use saved name)
  const dbName = deployedState.d1DatabaseName;
  s.start("D1 バックアップ中...");
  const backupPath = await backupDatabase(repoDir, dbName);
  s.stop(`D1 バックアップ: ${backupPath}`);
  s.start("マイグレーション確認中...");
  try {
    await migrateDatabase(repoDir, dbName, deployedState.d1DatabaseId);
    s.stop("マイグレーション完了");
  } catch (error) {
    s.stop("マイグレーション失敗（更新を中断）");
    p.log.error(`復旧用バックアップ: ${backupPath}`);
    throw error;
  }

  const secrets = JSON.parse(await wrangler(['secret', 'list', '--name', deployedState.workerName]));
  if (!secrets.some((secret: { name: string }) => secret.name === 'TOKEN_ENCRYPTION_KEY')) {
    const counts = JSON.parse(await wrangler(['d1', 'execute', dbName, '--remote', '--json', '--command', "SELECT COUNT(*) AS n FROM ig_accounts WHERE access_token LIKE 'enc:v1:%'"]));
    const rows = counts.flatMap((entry: { results?: Array<{ n: number }> }) => entry.results ?? []);
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]?.n)) throw new Error('Could not verify stored token encryption state; update aborted.');
    const encryptedCount = rows[0].n;
    if (encryptedCount > 0 && !deployedState.tokenEncryptionKey) throw new Error('Encrypted tokens exist but TOKEN_ENCRYPTION_KEY is missing. Restore the original key; do not generate a replacement.');
    deployedState.tokenEncryptionKey ??= randomBytes(32).toString('base64');
    const statePath = join(repoDir, '.ig-harness-deployed.json');
    writeFileSync(statePath, JSON.stringify(deployedState, null, 2) + '\n', { mode: 0o600 }); chmodSync(statePath, 0o600);
    await wrangler(['secret', 'put', 'TOKEN_ENCRYPTION_KEY', '--name', deployedState.workerName], { input: deployedState.tokenEncryptionKey });
  }
  if (deployedState.workerUrl) await wrangler(['secret', 'put', 'WORKER_URL', '--name', deployedState.workerName], { input: deployedState.workerUrl });
  if (deployedState.adminUrl) await wrangler(['secret', 'put', 'ADMIN_ORIGINS', '--name', deployedState.workerName], { input: new URL(deployedState.adminUrl).origin });

  // Deploy only to the fully recorded destination, preserving D1/R2 bindings.
  s.start("Worker 再デプロイ中...");
  await deployWorker({
    repoDir,
    d1DatabaseId: deployedState.d1DatabaseId,
    d1DatabaseName: deployedState.d1DatabaseName,
    workerName: deployedState.workerName,
    r2BucketName: deployedState.r2BucketName,
    accountId: deployedState.accountId,
  });
  s.stop("Worker 再デプロイ完了");

  // Rebuild and redeploy Admin UI
  const webDir = join(repoDir, "apps/web");

  s.start("Admin UI 再デプロイ中...");
  await execa("pnpm", ["run", "build"], { cwd: webDir });

  // Attempt to list Pages projects and find the ih-admin-* project
  let adminProjectName = deployedState.adminProjectName ?? "ig-harness-admin";
  if (deployedState.adminProjectName) {
    // Stable non-secret project name recorded by current installers.
  } else if (deployedState?.apiKey) {
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
