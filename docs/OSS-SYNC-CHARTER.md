# IG Harness OSS 同期方針

対象は `Shudesu/ig-harness`（開発用）と `Shudesu/ig-harness-oss`（公開用）。LINE Harness のリリースや設定は対象外。

- OSS の変更は、次の Private → OSS 同期前に開発側へ取り込む。未コミットの作業を上書きしない。
- 公開側の `scripts/`、`.github/workflows/check.yml`、Dependabot設定、SECURITY.mdを同期除外や `rsync --delete` で消さない。変更前に実際の同期スクリプトを確認する。
- `.env*`（`.env.example`を除く）、`.dev.vars`、資格情報を含むセットアップ状態・MCP設定・バックアップ・本番Wrangler設定は公開しない。
- `pnpm install --frozen-lockfile`、migrationテスト、各packageのtest/typecheck、管理画面buildを通す。
- リリースパッケージとREADMEの版を `pnpm check:versions` で照合する。db/ig-sdk/sharedは独立した版として扱う。
- タグは変更しない。変更後の新しい版でannotated tagを作り、検証したコミットにだけ付ける。過去版のタグが欠けている場合は対応コミットを確認してから追加する。
- npm公開には `pnpm publish` を使う。公開・デプロイ・実SNS送信は修正やテストと別の操作として扱い、依頼された権限範囲を守る。

本修正の運用・検証範囲は [review-remediation.md](operations/review-remediation.md) を参照。
