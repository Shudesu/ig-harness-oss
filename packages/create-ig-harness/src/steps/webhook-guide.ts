import * as p from "@clack/prompts";
import pc from "picocolors";

interface WebhookGuideOptions {
  workerUrl: string;
  metaVerifyToken: string;
}

export function showWebhookGuide(options: WebhookGuideOptions): void {
  const webhookUrl = `${options.workerUrl}/webhook`;

  p.note(
    [
      "╔══════════════════════════════════════════════╗",
      "║       Meta Webhook Setup Guide               ║",
      "╠══════════════════════════════════════════════╣",
      "║ 1. Go to developers.facebook.com/apps       ║",
      "║ 2. Select your app → Webhooks               ║",
      "║ 3. Subscribe to \"Instagram\" webhooks         ║",
      `║ 4. Callback URL: ${webhookUrl.slice(0, 26).padEnd(26)} ║`,
      `║ 5. Verify Token: ${options.metaVerifyToken.slice(0, 26).padEnd(26)} ║`,
      "║ 6. Subscribe: messages, messaging_postbacks  ║",
      "║ 7. Add \"comments\" field subscription         ║",
      "╚══════════════════════════════════════════════╝",
      "",
      `Callback URL:  ${pc.cyan(webhookUrl)}`,
      `Verify Token:  ${pc.cyan(options.metaVerifyToken)}`,
    ].join("\n"),
    "Meta Webhook の設定",
  );
}
