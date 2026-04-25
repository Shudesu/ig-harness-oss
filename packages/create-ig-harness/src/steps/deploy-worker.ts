import * as p from "@clack/prompts";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { wrangler } from "../lib/wrangler.js";

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
    const output = await wrangler(["deploy", "--config", deployTomlName], {
      cwd: workerDir,
    });

    // Parse worker URL from output
    const urlMatch = output.match(/(https:\/\/[^\s]+\.workers\.dev)/);
    const workerUrl = urlMatch
      ? urlMatch[1]
      : `https://${options.workerName}.workers.dev`;

    s.stop("Worker デプロイ完了");
    return { workerUrl };
  } finally {
    // Always remove the deploy-only config (success or failure)
    if (existsSync(deployTomlPath)) {
      unlinkSync(deployTomlPath);
    }
  }
}
