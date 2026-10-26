import * as p from "@clack/prompts";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { wrangler, WranglerError } from "../lib/wrangler.js";

interface DatabaseResult {
  databaseId: string;
  databaseName: string;
}

export async function createDatabase(
  repoDir: string,
  databaseName: string,
): Promise<DatabaseResult> {
  const s = p.spinner();

  // Create D1 database
  s.start("D1 データベース作成中...");
  let databaseId: string;
  try {
    const output = await wrangler(["d1", "create", databaseName]);
    // Parse database_id from TOML or JSON format
    const tomlMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
    const jsonMatch = output.match(/"database_id"\s*:\s*"([^"]+)"/);
    const uuidMatch = output.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    const match = tomlMatch || jsonMatch || uuidMatch;
    if (!match) {
      throw new Error(`D1 ID をパースできません: ${output}`);
    }
    databaseId = match[1];
    s.stop("D1 データベース作成完了");
  } catch (error) {
    if (
      error instanceof WranglerError &&
      error.stderr.includes("already exists")
    ) {
      s.stop("D1 データベースは既に存在します");
      const listOutput = await wrangler(["d1", "list", "--json"]);
      const databases = JSON.parse(listOutput);
      const db = databases.find(
        (d: { name: string }) => d.name === databaseName,
      );
      if (!db) {
        throw new Error("既存の D1 データベースが見つかりません");
      }
      databaseId = db.uuid;
    } else {
      throw error;
    }
  }

  s.start("テーブル作成中...");
  try {
    await migrateDatabase(repoDir, databaseName, databaseId);
  } catch (error) {
    s.stop("マイグレーション失敗（セットアップを中断）");
    throw error;
  }

  s.stop("テーブル作成完了");

  return { databaseId, databaseName };
}

/** All entry points use the repository's versioned migration runner. */
export async function migrateDatabase(repoDir: string, databaseName: string, databaseId: string): Promise<void> {
  const { runMigrations } = await import(pathToFileURL(join(repoDir, "scripts/migration-runner.mjs")).href);
  await runMigrations({ repoDir, databaseName, databaseId, remote: true, runWrangler: wrangler });
}
