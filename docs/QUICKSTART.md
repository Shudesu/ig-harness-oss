# IG Harness Quickstart

現行手順は [セルフホストのセットアップ](manual/02-setup.md)、[MCP接続](manual/08-mcp.md)、[運用と更新](operations/review-remediation.md) を参照。

```sh
git clone https://github.com/Shudesu/ig-harness-oss.git
cd ig-harness-oss
pnpm install --frozen-lockfile
pnpm --filter create-ig-harness build
pnpm deploy:setup
```

Node.js 22、Instagram Login用token、Instagram App Secretを使用する。Worker URLはセットアップ後にWORKER_URLへ自動設定される。手動導入時は必ず `pnpm db:migrate` を適用する。ローカル検証は `pnpm db:migrate:local`。schema.sql単体や別リポジトリの手順を使用しない。
