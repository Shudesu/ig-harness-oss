import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";

const REPO_URL = "https://github.com/Shudesu/ig-harness-oss.git";

/**
 * Clone the Instagram Harness repo and install dependencies.
 * Returns the path to the cloned repo.
 */
export async function ensureRepo(repoDir: string | null): Promise<string> {
  // If --repo-dir was given and has the repo, use it
  if (repoDir && existsSync(join(repoDir, "pnpm-workspace.yaml"))) {
    return repoDir;
  }

  // Check if cwd is the repo
  if (existsSync(join(process.cwd(), "pnpm-workspace.yaml"))) {
    return process.cwd();
  }

  // Check standard install location
  const homeDir = join(
    process.env.HOME || process.env.USERPROFILE || tmpdir(),
    ".ig-harness",
  );
  const isExisting = existsSync(join(homeDir, "pnpm-workspace.yaml"));

  if (isExisting) {
    // Pull latest
    const s = p.spinner();
    s.start("最新バージョンを取得中...");
    try {
      await execa("git", ["pull", "--ff-only"], { cwd: homeDir });
    } catch {
      // Non-critical, continue with existing
    }
    s.stop("リポジトリ更新完了");
  } else {
    // Clone fresh
    const s = p.spinner();
    s.start("IG Harness をダウンロード中...");

    try {
      await execa("git", ["clone", "--depth", "1", REPO_URL, homeDir]);
    } catch (error: any) {
      s.stop("ダウンロード失敗");
      throw new Error(
        `git clone に失敗しました: ${error.message}\ngit がインストールされているか確認してください。`,
      );
    }
    s.stop("ダウンロード完了");
  }

  // Install dependencies (always — handles both fresh clone and re-runs)
  const s = p.spinner();
  s.start("依存関係インストール中...");
  try {
    await execa("npx", ["pnpm", "install", "--frozen-lockfile"], {
      cwd: homeDir,
    });
  } catch {
    // Try without frozen lockfile
    await execa("npx", ["pnpm", "install"], { cwd: homeDir });
  }
  s.stop("依存関係インストール完了");

  // Build the library packages only — Worker bundling needs the @ig-harness/*
  // dist files. We must NOT build apps/* here: apps/web is a static export
  // (`output: 'export'`) that reads NEXT_PUBLIC_API_URL at build time, and that
  // env var isn't configured until the deploy-admin step writes .env.production.
  // A blanket `pnpm -r build` would prerender apps/web now and crash with
  // "NEXT_PUBLIC_API_URL is not set" before setup ever starts.
  s.start("ワークスペースパッケージをビルド中...");
  try {
    await execa("npx", ["pnpm", "--filter", "./packages/*", "build"], {
      cwd: homeDir,
    });
    s.stop("ビルド完了");
  } catch (error: any) {
    s.stop("ビルド失敗");
    throw new Error(
      `パッケージのビルドに失敗しました: ${error.stderr || error.message}`,
    );
  }

  return homeDir;
}
