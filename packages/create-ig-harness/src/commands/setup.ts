import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { checkDeps } from "../steps/check-deps.js";
import { ensureAuth, getAccountId } from "../steps/auth.js";
import { promptMetaCredentials } from "../steps/prompt.js";
import { createDatabase } from "../steps/database.js";
import { createR2Bucket } from "../steps/r2-bucket.js";
import { deployWorker } from "../steps/deploy-worker.js";
import { deployAdmin } from "../steps/deploy-admin.js";
import { setSecrets } from "../steps/secrets.js";
import { generateMcpConfig } from "../steps/mcp-config.js";
import { showWebhookGuide } from "../steps/webhook-guide.js";
import { generateApiKey } from "../lib/crypto.js";
import { setAccountId } from "../lib/wrangler.js";

interface SetupState {
  metaAppId?: string;
  metaAppSecret?: string;
  metaAccessToken?: string;
  metaVerifyToken?: string;
  igUserId?: string;
  apiKey?: string;
  d1DatabaseId?: string;
  d1DatabaseName?: string;
  r2BucketName?: string;
  workerName?: string;
  accountId?: string;
  workerUrl?: string;
  adminUrl?: string;
  resourceSuffix?: string;
  completedSteps: string[];
}

function getStatePath(repoDir: string): string {
  return join(repoDir, ".ig-harness-setup.json");
}

function loadState(repoDir: string): SetupState {
  const path = getStatePath(repoDir);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // corrupt file, start fresh
    }
  }
  return { completedSteps: [] };
}

function saveState(repoDir: string, state: SetupState): void {
  writeFileSync(getStatePath(repoDir), JSON.stringify(state, null, 2) + "\n");
}

function isDone(state: SetupState, step: string): boolean {
  return state.completedSteps.includes(step);
}

function markDone(state: SetupState, step: string): void {
  if (!state.completedSteps.includes(step)) {
    state.completedSteps.push(step);
  }
}

export async function runSetup(repoDir: string): Promise<void> {
  p.intro(pc.bgMagenta(pc.black(" Instagram Harness セットアップ ")));

  p.note(
    `${pc.bold("📖 セットアップガイド (スクリーンショット付き):")}\n   ${pc.cyan("https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide")}\n\n   各ステップで詰まったらこのページを参照してください。`,
    "はじめに",
  );

  const state = loadState(repoDir);

  if (state.completedSteps.length > 0) {
    p.log.info(
      `前回の途中から再開します（完了済み: ${state.completedSteps.join(", ")}）`,
    );
  }

  // Step 1: Check dependencies
  await checkDeps();

  // Step 2: Authenticate with Cloudflare
  await ensureAuth();

  // Step 2.5: Get account ID
  if (!state.accountId) {
    const accountId = await getAccountId();
    state.accountId = accountId;
    saveState(repoDir, state);
    p.log.success(`Cloudflare アカウント: ${accountId}`);
  }
  setAccountId(state.accountId);

  // Step 3: Get Meta / Instagram credentials (skip if already saved)
  if (!isDone(state, "credentials")) {
    const credentials = await promptMetaCredentials();
    state.metaAppId = credentials.metaAppId;
    state.metaAppSecret = credentials.metaAppSecret;
    state.metaAccessToken = credentials.metaAccessToken;
    state.metaVerifyToken = credentials.metaVerifyToken;
    state.igUserId = credentials.igUserId;
    markDone(state, "credentials");
    saveState(repoDir, state);
  } else {
    p.log.success("Meta 資格情報: 入力済み（スキップ）");
  }

  // Step 4: Generate API key (skip if already generated)
  if (!state.apiKey) {
    state.apiKey = generateApiKey();
    saveState(repoDir, state);
  }

  // Step 4.5: Generate a random suffix once and reuse it across worker / D1 / R2.
  // Guarantees no name collision with anyone else's deploy on the same account.
  if (!state.resourceSuffix) {
    state.resourceSuffix = randomBytes(4).toString("hex");
    saveState(repoDir, state);
  }
  const baseName = `ig-harness-${state.resourceSuffix}`;
  const workerName = state.workerName ?? baseName;
  const databaseName = state.d1DatabaseName ?? baseName;
  const r2BucketName = state.r2BucketName ?? `${baseName}-images`;
  state.workerName = workerName;
  state.r2BucketName = r2BucketName;
  saveState(repoDir, state);

  // Step 5: Create R2 bucket for image hosting
  if (!isDone(state, "r2bucket")) {
    await createR2Bucket(r2BucketName);
    markDone(state, "r2bucket");
    saveState(repoDir, state);
  } else {
    p.log.success(`R2 バケット: 作成済み（${r2BucketName}）（スキップ）`);
  }

  // Step 6: Create D1 database + run migrations
  if (!isDone(state, "database")) {
    const { databaseId, databaseName: createdName } = await createDatabase(
      repoDir,
      databaseName,
    );
    state.d1DatabaseId = databaseId;
    state.d1DatabaseName = createdName;
    markDone(state, "database");
    saveState(repoDir, state);
  } else {
    p.log.success(`D1 データベース: 作成済み（${state.d1DatabaseId}）`);
  }

  // Step 7: Deploy Worker
  if (!isDone(state, "worker")) {
    const { workerUrl } = await deployWorker({
      repoDir,
      d1DatabaseId: state.d1DatabaseId!,
      d1DatabaseName: state.d1DatabaseName!,
      r2BucketName: state.r2BucketName!,
      workerName,
      accountId: state.accountId!,
    });
    state.workerUrl = workerUrl;
    markDone(state, "worker");
    saveState(repoDir, state);
  } else {
    p.log.success(`Worker: デプロイ済み（${state.workerUrl}）`);
  }

  // Step 8: Set secrets
  if (!isDone(state, "secrets")) {
    await setSecrets({
      workerName,
      metaAppSecret: state.metaAppSecret!,
      metaAccessToken: state.metaAccessToken!,
      metaVerifyToken: state.metaVerifyToken!,
      igUserId: state.igUserId!,
      apiKey: state.apiKey!,
    });
    markDone(state, "secrets");
    saveState(repoDir, state);
  } else {
    p.log.success("シークレット: 設定済み");
  }

  // Step 9: Deploy Admin UI via CF Pages
  const suffix = state.apiKey!.slice(0, 8);
  const adminProjectName = `ih-admin-${suffix}`;
  if (!isDone(state, "admin")) {
    const { adminUrl } = await deployAdmin({
      repoDir,
      workerUrl: state.workerUrl!,
      apiKey: state.apiKey!,
      projectName: adminProjectName,
    });
    state.adminUrl = adminUrl;
    markDone(state, "admin");
    saveState(repoDir, state);
  } else {
    p.log.success(`Admin UI: デプロイ済み（${state.adminUrl}）`);
  }

  // Step 10: Show webhook setup guide
  showWebhookGuide({
    workerUrl: state.workerUrl!,
    metaVerifyToken: state.metaVerifyToken!,
  });

  // Step 11: Generate MCP config
  const addMcp = await p.confirm({
    message: "MCP 設定を .mcp.json に追加しますか？（Claude Code / Cursor 用）",
  });
  if (addMcp && !p.isCancel(addMcp)) {
    await generateMcpConfig({ workerUrl: state.workerUrl!, apiKey: state.apiKey!, repoDir });
  }

  // Step 12: Show completion screen
  p.note(
    [
      `${pc.bold("① Webhook を Meta Developer Console で設定してください:")}`,
      `   Callback URL: ${pc.cyan(`${state.workerUrl}/webhook`)}`,
      `   Verify Token: ${pc.cyan(state.metaVerifyToken!)}`,
      `   → developers.facebook.com/apps → Webhooks → Instagram`,
      `   → messages, messaging_postbacks, comments を購読`,
      "",
      `${pc.bold("② Meta App 公開時に Dashboard へ貼り付ける URL:")}`,
      `   Privacy Policy URL:   ${pc.cyan(`${state.workerUrl}/privacy-policy`)}`,
      `   Data Deletion URL:    ${pc.cyan(`${state.workerUrl}/data-deletion`)}`,
      `   Terms of Service URL: ${pc.cyan(`${state.workerUrl}/terms-of-service`)}`,
      `   → developers.facebook.com/apps → アプリ設定 → ベーシック`,
      `   → アプリアイコン (1024x1024 PNG) と カテゴリ (ビジネス) も忘れずに`,
      "",
      `${pc.bold("③ 管理画面:")}`,
      `   ${pc.cyan(state.adminUrl!)}`,
      "",
      `${pc.bold("④ API Key:")}`,
      `   ${pc.dim(state.apiKey!)}`,
      `   → この値は再表示できません。安全な場所に保存してください`,
    ].join("\n"),
    "セットアップ完了！",
  );

  // Write a lightweight deployed-state file so `update` can resolve the correct
  // admin project name and API key without re-running the full wizard.
  const deployedStatePath = join(repoDir, ".ig-harness-deployed.json");
  writeFileSync(
    deployedStatePath,
    JSON.stringify(
      {
        apiKey: state.apiKey,
        workerUrl: state.workerUrl,
        adminUrl: state.adminUrl,
        workerName: state.workerName,
        d1DatabaseId: state.d1DatabaseId,
        d1DatabaseName: state.d1DatabaseName,
        accountId: state.accountId,
      },
      null,
      2,
    ) + "\n",
  );

  // Clean up setup state file on success (contains secrets — don't leave on disk)
  const statePath = getStatePath(repoDir);
  if (existsSync(statePath)) {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(statePath);
  }

  p.note(
    `${pc.bold("📖 詳しい解説 (Meta App公開手順、トラブルシュート、運用Tips):")}\n   ${pc.cyan("https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide")}`,
    "セットアップガイド",
  );

  p.outro(pc.green("Instagram Harness を使い始めましょう 🚀"));
}
