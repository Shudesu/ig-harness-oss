import * as p from "@clack/prompts";
import { wrangler, WranglerError } from "../lib/wrangler.js";

export async function createR2Bucket(bucketName: string): Promise<void> {
  const s = p.spinner();
  s.start("R2 バケット作成中...");

  try {
    await wrangler(["r2", "bucket", "create", bucketName]);
    s.stop(`R2 バケット作成完了 (${bucketName})`);
  } catch (error) {
    if (
      error instanceof WranglerError &&
      (error.stderr.includes("already exists") ||
        error.stderr.includes("10006"))
    ) {
      s.stop(`R2 バケットは既に存在します (${bucketName})`);
    } else {
      s.stop("R2 バケット作成失敗");
      throw error;
    }
  }
}
