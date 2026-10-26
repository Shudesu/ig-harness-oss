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
- CORS・ブラウザ認証は下記「LINE移植ガイドの反映」でHttpOnlyセッション方式に更新。以前のADMIN_ORIGINSとBearerクライアントは互換維持。
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


## 継続確認: 初期導入・更新・配信開始の競合

- `--repo-dir`指定とrepo内からのsetupでも、固定lockfileで依存を導入しライブラリをbuildする。明示指定の作業コピーをgit pullしない。別製品のworkspaceは拒否する。
- updateは保存済みWorker URLで管理画面を先にbuildし、成功してからバックアップ・migration・反映へ進む。ローカルbuild失敗時はリモート変更を開始しない。
- Pages反映先は保存済みadminProjectName、または保存済みの正規 `*.pages.dev` URLから確定する。APIキー断片・一覧の先頭プロジェクトから推測しない。独自ドメインだけを保存している旧構成では、実在するadminProjectNameを補う。
- migration成功後にWorker/Pages反映が失敗した場合も、バックアップの保存先と一部反映の可能性を表示する。
- broadcastの開始は状態更新と行取得を一つのSQLで実行する。先に成立した編集を含む本文を使用し、開始後の編集・削除はDBの条件付き更新でも拒否する。不正なtag filterは開始前に止める。
- 回帰ケースを11件追加。`pnpm -r test`はinstaller 11件、ig-sdk 18件、SDK 46件、Worker 171件の計246件が通過。対象全packageのtypecheckも通過。

OSS mainは `52fbba3` のままで競合なし。Private側には別の未コミット作業があるため上書きしていない。Privateへの統合、本番反映、タグ・npm公開、GitHubの必須チェック設定は公開後の別工程として扱う。


## LINE移植ガイドの反映（※Codex修正後の挙動）

対象はIGのみ。参照元LINEと別作業のThreadsは変更していない。

- Cookie認証に先立ち `/t/:id` の保存型XSSを修正。HTTP(S) URLを作成時と遷移時の両方で検証し、JavaScript文字列はJSONシリアライズ＋ `<` / U+2028 / U+2029のエスケープを行う。CSP nonceを使う。`/connect`のtoken/username、`/line`のLIFF IDも形式検証し、公開HTMLのCSPを設定する。IG_USERNAMEが未設定の場合は503とし、仮のInstagramアカウントへ誘導しない。
- 比較は固定長SHA-256へ統一し、空値は不一致。IG webhook challengeとLINE連携secretの呼び出しをasync/awaitへ変更。HMAC署名検証の正常系は維持する。SDKのverifyWebhookChallengeを直接使う利用者はawaitが必要。
- CORSはLINEの主要ホスティングsuffix・Pagesプレビュー判定を参照し、ADMIN_ORIGINと資格情報付きリクエストへ対応。旧ADMIN_ORIGINSは互換名。設定不足を警告し、起動済みWorkerの既存origin secretはinstallerが上書きしない。手動で[vars]に置いたADMIN_*は更新前に同じ値をsecretへ移す。Worker更新には --keep-vars を付ける。
- ブラウザはランダムIDのHttpOnly Cookieセッションに移行。APIキーをCookieやブラウザ永続領域へ保存しない。D1にはsession/credential/CSRFのハッシュを保存。CSRF二重送信に加えてsessionとの対応を検証し、Originも許可リストで確認する。キー再発行・スタッフ無効化・権限変更は次のリクエストに反映される。logoutはセッションを失効させる。
- login本文は読み込み中に8KBで制限し、超過は保存処理前に413で止める。loginは10回/分/IP、全体は3000回/分/IP、Cookie・Bearerはcredential全体のハッシュで制限する。これはisolate内のバースト抑止であり、全拠点をまたぐ厳密な共有quotaではない。
- `0020_admin_sessions.sql` は追加的なsession table。`0021_tracked_link_actions.sql` は実DBテストで見つかった旧tracked-link helperとcanonical schemaの不整合を直す補助列。既存の整数ID、destination_url、ref_code、click履歴を保持し、API側で従来のoriginalUrl等の名前に整える。リンク先タグ/シナリオが削除されたら参照だけNULLにする。
- 既存のmigration ledger・SHA-256形式・staff鍵保存方式を維持。名前をLINE風へ変えるためだけのDB更新はしない。従来の0019修復を含む履歴をchecksum manifestで固定し、0020以降の破壊的DDLをCI・runnerで拒否する。SQLの文字列・識別子・コメントを考慮して判定する。
- 適用後はcritical table/columnを実スキーマから確認し、履歴だけで成功扱いにしない。一時的なD1読み取りは最大3回。書き込みは既に成功している可能性があるため盲目的に再試行しない。
- staff鍵は前回実装のCLI一括hash化を維持。ログイン待ちで平文を残す遅延移行や、別のhash列・rehash APIは追加しない。

Cookie属性と資格情報付きfetchは [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)、セッションに結び付けたCSRF検証は [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) を参照。HTTPテストとbuildはブラウザ固有のCookie制限や実Meta接続を証明するものではない。

今回の移植後の確認: Worker 192件、ig-sdk 20件、SDK 46件、installer 14件、migration/policy/read-retry 8件、MCP stdio 1件（計281件）を通過。全対象のtypecheck、管理画面・Worker・installerのbuildも通過。既存のローカルD1へ0020/0021を適用し、スキーマ確認を通過した。リモートD1・実ブラウザ・実Meta送信は操作していない。
