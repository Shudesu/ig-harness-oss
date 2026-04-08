import * as p from "@clack/prompts";
import { wrangler, WranglerError } from "../lib/wrangler.js";

const BUCKET_NAME = "ig-harness-images";

export async function createR2Bucket(): Promise<void> {
  const s = p.spinner();
  s.start("R2 バケット作成中...");

  try {
    await wrangler(["r2", "bucket", "create", BUCKET_NAME]);
    s.stop(`R2 バケット作成完了 (${BUCKET_NAME})`);
  } catch (error) {
    if (
      error instanceof WranglerError &&
      (error.stderr.includes("already exists") ||
        error.stderr.includes("10006"))
    ) {
      s.stop(`R2 バケットは既に存在します (${BUCKET_NAME})`);
    } else {
      s.stop("R2 バケット作成失敗");
      throw error;
    }
  }
}
