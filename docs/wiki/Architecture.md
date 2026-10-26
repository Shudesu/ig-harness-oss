# IG Harnessの構成

`apps/web` はNext.js管理画面、`apps/worker` はHono APIとWebhook/cron/DO、`packages/db` はD1、`packages/ig-sdk` はInstagram Graph API、`packages/sdk` は管理APIクライアント、`packages/mcp-server` はstdio MCP、`packages/create-ig-harness` は導入・更新CLIです。

通常の導入ではPages管理画面とWorkerを分けます。WFPテナントではTenantSchedulerがcronを補います。broadcast・Webhook・遅延コメントはD1に状態を保持し、未送信の作業を再開します。結果不明な外部送信を自動で繰り返しません。

[運用設計](../operations/review-remediation.md)を参照。
