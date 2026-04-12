import * as p from "@clack/prompts";
import { wrangler } from "../lib/wrangler.js";

interface SecretsOptions {
  workerName: string;
  metaAppSecret: string;
  metaAccessToken: string;
  metaVerifyToken: string;
  igUserId: string;
  apiKey: string;
  /**
   * Shared secret used by LINE Harness to call POST /api/followers/link-line.
   * Generated automatically if not supplied. Without this, the cross-platform
   * UUID linking endpoint rejects every request with 401.
   */
  lineHarnessLinkSecret?: string;
}

export async function setSecrets(options: SecretsOptions): Promise<void> {
  const s = p.spinner();
  s.start("シークレット設定中...");

  // Secret names must match the Env interface in apps/worker/src/index.ts
  const linkSecret = options.lineHarnessLinkSecret ?? generateSecret();
  const secrets: Record<string, string> = {
    IG_APP_SECRET: options.metaAppSecret,
    IG_ACCESS_TOKEN: options.metaAccessToken,
    IG_VERIFY_TOKEN: options.metaVerifyToken,
    IG_USER_ID: options.igUserId,
    API_KEY: options.apiKey,
    LINE_HARNESS_LINK_SECRET: linkSecret,
  };

  for (const [name, value] of Object.entries(secrets)) {
    await wrangler(["secret", "put", name, "--name", options.workerName], {
      input: value,
    });
  }

  s.stop("シークレット設定完了");
  p.log.info(
    `LINE Harness 連携用 shared secret を設定しました。LINE Harness 側にも同じ値を IG_HARNESS_LINK_SECRET としてセットしてください:\n  ${linkSecret}`,
  );
}

function generateSecret(): string {
  // 32 bytes of randomness, hex-encoded → 64 chars. Matches what we set
  // by hand in the production deploy.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
