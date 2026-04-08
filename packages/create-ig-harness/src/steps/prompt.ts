import * as p from "@clack/prompts";
import { randomBytes } from "node:crypto";

export interface MetaCredentials {
  metaAppId: string;
  metaAppSecret: string;
  metaAccessToken: string;
  metaVerifyToken: string;
  igUserId: string;
}

export async function promptMetaCredentials(): Promise<MetaCredentials> {
  p.log.step(
    "Meta for Developers でアプリ情報を確認してください\nhttps://developers.facebook.com/apps/",
  );

  p.log.info(
    [
      "必要な情報:",
      "  1. Meta App ID / App Secret — アプリ基本設定から取得",
      "  2. Page Access Token (長期) — Instagram ビジネスアカウントに接続したページのトークン",
      "  3. Webhook Verify Token — 任意の文字列（セットアップ後に Webhook 設定で使用）",
      "  4. Instagram Business Account ID — Instagram Graph API で取得",
      "",
      "まだ設定していなければ、上のURLから Meta アプリを作成してください。",
    ].join("\n"),
  );

  // --- Meta App ---
  p.log.message(
    [
      "── Meta App ──",
      "場所: developers.facebook.com/apps → アプリを選択 → 設定 → 基本",
    ].join("\n"),
  );

  const metaAppId = await p.text({
    message: "App ID（数字）",
    placeholder: "設定 → 基本 → アプリID",
    validate(value) {
      if (!value || !/^\d+$/.test(value.trim())) {
        return "App ID は数字で入力してください";
      }
    },
  });
  if (p.isCancel(metaAppId)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  const metaAppSecret = await p.text({
    message: "App Secret",
    placeholder: "設定 → 基本 → アプリシークレット → 表示",
    validate(value) {
      if (!value || value.trim().length < 10) {
        return "App Secret を入力してください";
      }
    },
  });
  if (p.isCancel(metaAppSecret)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // --- Page Access Token ---
  p.log.message(
    [
      "── Page Access Token ──",
      "場所: developers.facebook.com/apps → Instagram → API の設定",
      "  → アクセストークンを生成（長期トークン推奨）",
      "  ※ Instagram ビジネスアカウントに接続したFacebookページが必要です",
    ].join("\n"),
  );

  const metaAccessToken = await p.text({
    message: "Page Access Token",
    placeholder: "EAA... で始まる長い文字列",
    validate(value) {
      if (!value || value.trim().length < 20) {
        return "Page Access Token を入力してください";
      }
    },
  });
  if (p.isCancel(metaAccessToken)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // --- Verify Token ---
  p.log.message(
    [
      "── Webhook Verify Token ──",
      "任意の文字列を設定してください。",
      "この値は後で Meta Developer Console の Webhook 設定で使用します。",
    ].join("\n"),
  );

  const defaultVerifyToken = randomBytes(16).toString("hex");
  const metaVerifyToken = await p.text({
    message: "Verify Token（任意の文字列）",
    placeholder: defaultVerifyToken,
    initialValue: defaultVerifyToken,
    validate(value) {
      if (!value || value.trim().length < 6) {
        return "Verify Token は6文字以上で入力してください";
      }
    },
  });
  if (p.isCancel(metaVerifyToken)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  // --- Instagram Business Account ID ---
  p.log.message(
    [
      "── Instagram Business Account ID ──",
      "取得方法: Graph API Explorer で次のクエリを実行:",
      "  GET /me?fields=id,name&access_token={page_access_token}",
      "  または: /me/accounts でページ一覧 → Instagram ビジネスアカウントのID",
    ].join("\n"),
  );

  const igUserId = await p.text({
    message: "Instagram Business Account ID（数字）",
    placeholder: "例: 17841400008460056",
    validate(value) {
      if (!value || !/^\d+$/.test(value.trim())) {
        return "Instagram Business Account ID は数字で入力してください";
      }
    },
  });
  if (p.isCancel(igUserId)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }

  return {
    metaAppId: (metaAppId as string).trim(),
    metaAppSecret: (metaAppSecret as string).trim(),
    metaAccessToken: (metaAccessToken as string).trim(),
    metaVerifyToken: (metaVerifyToken as string).trim(),
    igUserId: (igUserId as string).trim(),
  };
}
