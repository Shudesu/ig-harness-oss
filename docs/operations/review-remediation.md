# 2026-10-26 OSSレビュー対応

基準: ig-harness-oss `52fbba3`。P0–P2、追補A1–A6/C1–C2、追加Grokレビューの再現する不具合が対象。AI返信レイヤー等の新機能や外部公開・本番更新は含まない。

## 導入と更新

Node.js 22、pnpm 9.15.4を使用する。`pnpm install --frozen-lockfile` 後、手動実行は `pnpm db:migrate:local` / `pnpm db:migrate`。Wrangler設定のD1 binding `DB` が対象。setup/updateも同じ `scripts/migration-runner.mjs` を使用する。

- 新規DBだけにschema.sqlを適用。既存DBに最新schema.sqlを重ねない。
- 0001–0017は実スキーマを確認して、過去の重複ALTERや部分適用を取り扱う。未知の型不一致・失敗は停止する。
- `ig_schema_migrations` にファイル名・SHA-256を記録。適用済みファイルの書き換えは拒否する。migration失敗を「変更なし」と表示しない。
- 0018は配信・Webhook・削除受付の記録、profile取得時刻、最終inbound時刻、シナリオ終了理由を追加。0019はstaffのUUIDキーとemail/updated_atを整合させる。既存staffキーはrunnerでSHA-256へ移行する。
- updateは、保存済み接続先を確認し、migrationより先にD1 exportを作る。既定はrepo内 `.backups/`、`IG_HARNESS_BACKUP_DIR` で変更できる。バックアップには顧客情報・トークンが含まれるため0700のディレクトリと0600のファイルで保持する。更新失敗時は表示されたパスから復旧を検討する。自動restoreや自動削除はしない。
- 古い `.ig-harness-deployed.json` に `r2BucketName` が無い場合は、実際のWorker bindingを確認して補う。名前を推測して別バケットへ接続しない。
- 旧Workerはハッシュ済みstaffキーや暗号化トークンを扱えない。メンテナンス時間を確保し、DB更新と新Worker反映を一組で行う。DBだけ進めたまま旧コードへ戻さない。

## 配信・Webhook

broadcastは宛先をD1内でスナップショット化し、1回10件まで送る。残りはcron/DOで再開する。最終inboundから24時間を超える宛先は `skipped/window_closed`。途中で送信結果が不明になった相手は `uncertain` として自動再送しない。API成功後のDB保存失敗も同様。`sent` は処理終了を表し、全員への到達を保証しない。`GET /api/broadcasts/:id` の `deliverySummary` で理由別件数を確認する。

Webhookは200応答の前にイベントを保存し、accountとmid/comment idに基づくキーで重複排除する。未着手イベントは再開できる。処理中に停止したイベントは `uncertain` に留め、外部への効果を確認せず再実行しない。成功後はpayloadを破棄し、再送防止キーを残す。profileは最終取得成功から24時間キャッシュする。

コメントルールの遅延は `comment_rule_jobs` に保存する。従来の通常DM APIを使用するルールには実inboundの24時間枠が必要で、コメントだけでは通常DMの枠を開かない。枠外は試行せず理由を残す。公開コメントはDM成功後に送る。既存のゲートとは別経路。

シナリオは送信直前にinboundを確認し、期限超過または不明なら `follower_scenarios.end_reason=window_expired` で終了する。送信時間帯のJST制御も維持する。

## 認証・秘密・削除

- owner: 全管理。admin: 通常の変更と配信。staff: 読み取り専用。integrations/LINE接続/削除処理/アカウント移行はownerのみ。タグ操作も自動化を起動し得るためstaffには許可しない。
- API_KEYが空でも空Bearerでは認証できない。環境キーの比較は固定長ハッシュ比較。スタッフキーはSHA-256保存、新規キーは `igh_`、既存 `lh_` キーも元の値で認証できる。
- `TOKEN_ENCRYPTION_KEY` は32バイト乱数のbase64。セットアップが生成し、updateは既存secretを確認して未設定時だけ作る。新規・変更・refresh時のIG tokenはaccount IDをAADにしたAES-GCMで保存。既存の平文はcronで1回20件まで移行し、既定アカウントの旧singleton tokenを除去する。旧DBにキー未設定の間は読み取り互換が残るが、新規credential保存にはキーが必要。鍵を失うと復号できないので安全にバックアップし、安易にローテーションしない。
- env tokenは初期seedと既定accountのrefresh復旧候補。通常の再接続はownerによる `PATCH /api/accounts/:id` の `accessToken`。envを変えただけで新しいDB tokenを上書きしない。refresh失敗/期限不明時の試行は1時間に1回まで。
- CORSは同一originと `ADMIN_ORIGINS`（カンマ区切りの正確なorigin）のみ。setup/updateは保存済み管理画面originを設定する。独自ドメインを追加した場合は再確認する。管理画面のキーはsessionStorageとし旧localStorageキーを除去する。これはXSSを無害化する仕組みではない。
- `/line` は明示的なLINE_LIFF_IDまたはHTTPSのLINE_ADD_URLが必須。公開testページと作者個人のデフォルト値は削除。

削除callbackはHMAC-SHA256 signed_requestを検証し、受付と確認コードをDBに保存する。Metaのapp-scoped user_idをIGSIDと同一視しない。このインストーラはOAuth identity mappingを保持していないため、自動で人物を推測せず `pending_identity` を表示する。

ownerは `GET /api/data-deletion` から未処理を確認し、本人・対象accountを検証した後、`POST /api/data-deletion/:code/resolve` に `{accountId, followerId, identityVerified:true}` を渡す。followerId省略はそのaccount全体の対象データとトークンの削除。フォロワー・メッセージ・関連履歴の削除と完了記録をD1 batchで実行する。別accountへは署名Appの範囲を超えて削除しない。確認用の匿名化した記録と再作成防止のaccount tombstoneは残す。

削除中は新規変更/ジョブclaimを止め、実行中の作業があれば409で待機する。停止したプロセスが `active_mutations` を残した場合、**自動で期限切れ扱いにしない**。運用者が旧処理の終了を確認し、残ったIDを確認してから復旧する。DB/R2インスタンス自体は削除しない。外部SNS側の履歴削除や、R2内の汎用アップロードの本人との対応付けはこのcallbackの対象外で、別途確認する。

## 保持・監視・コスト

`MESSAGES_RETENTION_DAYS=0`（既定）は保持継続。保存の約束と照合したうえで、例えば `180` を設定した環境だけ、cron毎に期限外messages_logを最大100行削除する。最終inbound時刻はfollowersに独立保存され、log整理で配信枠を延長しない。

getMe疎通確認は1時間間隔。heartbeatは15分ごとに更新し、状態だけが同じでも停止を検出できるようにする。外部監視では20分以上の遅延を停止候補とする。空ティックでは存在確認で各processorの実行を省く。

Worker observabilityを有効化。生のトークン・Webhook本文・Graphエラー本文はログに出さない。Cloudflare側の保持期間・上限は契約設定に従うため、リリース時に確認する。ログは長期の顧客データ保管先にしない。

## 検証と公開前に残る確認

ローカルSQLite、ローカルD1、HTTPテスト、型検査、管理画面ビルド、MCP stdio handshakeで検証する。Metaの実Appによる署名・購読・実DM、リモートD1 import/export、本番E2Eはローカルテストでは証明しない。実送信は別途明示したテスト宛先・権限でのみ実施する。

Grok指摘のうち、Webhookガイドの全文は元から枠の下に存在していた。独立したGraph版のハードコードは設定可能にしたが、既定v21.0を未検証の版へ勝手に上げない。更新時はMeta公式変更点とread/send/publishの契約を検証する。

タグは既存タグを動かさず、検証済み新バージョンへ追加する。CIチェックをbranch protectionの必須項目にし、GitHub private vulnerability reportingを有効化する設定は、リポジトリ公開操作の段階で確認する。

## この作業での検証結果

- Worker 167件、SDK 46件、ig-sdk 18件、installer 4件、migration 4件、MCP stdio 1件を通過。
- 全対象packageのtypecheck、Next.js管理画面build、Worker buildを通過。
- `pnpm install --frozen-lockfile` を確認。ローカルD1で全19 migrationを適用し、再実行時に重複適用しないことを確認。
- 外部ディスクでのテスト並列I/Oによる5秒timeoutを確認したため、fixtureのスキーマ読み取りをプロセス単位で再利用しWorkerテスト並列数を2に制限。DB自体はテストごとに新規作成し、タイムアウト値を延ばして隠す変更はしていない。
- 本番DB・実配信・公開リポジトリ設定は変更していない。
