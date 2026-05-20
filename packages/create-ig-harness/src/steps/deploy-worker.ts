import * as p from "@clack/prompts";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { wrangler, WranglerError } from "../lib/wrangler.js";

const WORKERS_DEV_URL = /(https:\/\/[^\s]+\.workers\.dev)/;
const TTY_REQUIRED = /non[- ]?interactive|cloudflare_api_token|consent denied|authentication error|expired/i;

interface DeployWorkerOptions {
  repoDir: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  r2BucketName: string;
  workerName: string;
  accountId: string;
}

interface DeployWorkerResult {
  workerUrl: string;
}

export async function deployWorker(
  options: DeployWorkerOptions,
): Promise<DeployWorkerResult> {
  const s = p.spinner();
  const workerDir = join(options.repoDir, "apps/worker");
  // Use a deploy-only config file so the user's wrangler.toml is never
  // touched. wrangler resolves --config relative to its cwd.
  const deployTomlName = "wrangler.deploy.toml";
  const deployTomlPath = join(workerDir, deployTomlName);

  s.start("Worker デプロイ中...");
  const deployToml = `name = "${options.workerName}"
main = "src/index.ts"
compatibility_date = "2024-12-01"
workers_dev = true
account_id = "${options.accountId}"

[[d1_databases]]
binding = "DB"
database_name = "${options.d1DatabaseName}"
database_id = "${options.d1DatabaseId}"

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "${options.r2BucketName}"

[triggers]
crons = ["*/5 * * * *"]
`;
  writeFileSync(deployTomlPath, deployToml);

  try {
    let workerUrl: string;
    try {
      const output = await wrangler(["deploy", "--config", deployTomlName], {
        cwd: workerDir,
      });
      const urlMatch = output.match(WORKERS_DEV_URL);
      if (!urlMatch) {
        throw new Error(`Worker URL を出力からパースできません:\n${output}`);
      }
      workerUrl = urlMatch[1];
    } catch (firstError) {
      const isAuthError =
        firstError instanceof WranglerError &&
        TTY_REQUIRED.test(firstError.stderr);
      if (!isAuthError) throw firstError;

      s.stop("wrangler 認証更新のため対話モードで再実行します...");
      await wrangler(["deploy", "--config", deployTomlName], {
        cwd: workerDir,
        tty: true,
      });

      const output = await wrangler(["deploy", "--config", deployTomlName], {
        cwd: workerDir,
      });
      const urlMatch = output.match(WORKERS_DEV_URL);
      if (!urlMatch) {
        throw new Error(
          [
            "Worker のデプロイは完了しましたが URL を取得できませんでした。",
            "もう一度同じ update/setup コマンドを実行すると URL 取得を再試行します。",
          ].join("\n"),
        );
      }
      workerUrl = urlMatch[1];
    }

    s.stop("Worker デプロイ完了");
    return { workerUrl };
  } finally {
    // Always remove the deploy-only config (success or failure)
    if (existsSync(deployTomlPath)) {
      unlinkSync(deployTomlPath);
    }
  }
}
