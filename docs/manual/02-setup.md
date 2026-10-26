# セルフホストのセットアップ

Node.js 22とpnpm 9.15.4、本人のCloudflareアカウント、Instagramプロアカウントを用意する。対象リポジトリは `Shudesu/ig-harness-oss`。`instagram-harness-oss` は別プロジェクト。

```sh
git clone https://github.com/Shudesu/ig-harness-oss.git
cd ig-harness-oss
pnpm install --frozen-lockfile
pnpm --filter create-ig-harness build
pnpm deploy:setup
```

この実装は **Instagram API with Instagram Login** を利用する。Facebook Page tokenを求める古い案内は使用しない。MetaアプリのInstagramログイン用API設定から、Instagram App SecretとInstagramの長期access tokenを取得する。IGAA/IGQVJ等の接頭辞で受け入れ可否を決めず、ウィザードが `graph.instagram.com/v25.0/me?fields=user_id,username` で確認する。`IG_USER_ID` は応答の `user_id`。`id` を手入力して取り違えない。

ウィザードはD1 migration、R2、Worker、Pages管理画面、必要なsecret、アカウント単位のsubscribed_apps設定を処理する。App側のWebhook callback/verify tokenと購読フィールドは表示される手順でも確認する。`messages`、`messaging_postbacks`、`messaging_referral`、`comments` を使用する。ストーリーメンションのDM添付もmessages経路で扱う。

Instagram側でメッセージへのアクセス許可、アプリのテスター参加、開発モードで許可されたアカウントを確認する。LiveモードやAdvanced Accessの要否は実際の権限・用途に従う。[Meta公式Instagram Login資料](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)を参照。

管理画面は完了時に表示されたPages URL。環境 `API_KEY` がowner権限なので、DBにownerを直接INSERTしない。追加staffはAPIで作る。管理画面はHttpOnly Cookieでログインし、APIキーをlocalStorage/sessionStorageに保存しない。Cookieは最長7日、ログアウト・キー再発行・無効化で失効する。SDK/MCPはBearer認証を継続する。

`.ig-harness-setup.json` は失敗時の再開用秘密を含み0600。成功後は削除される。`.ig-harness-deployed.json` と生成MCP設定も秘密を含むためGitへ入れない。`TOKEN_ENCRYPTION_KEY` を保存せず捨てたり、更新のたびに再生成したりしない。

手動構成では `.env.example` と [運用手順](../operations/review-remediation.md) の必須変数、CORS、migration手順を確認する。`schema.sql` 単体で導入を完了としない。


## Admin origin とCookie（※Codex修正後の挙動）

`ADMIN_ORIGIN` に管理画面の正確なoriginを設定する。複数はカンマ区切り。以前の `ADMIN_ORIGINS` は互換名として、単数形が未設定の場合だけ利用する。同一Pagesプロジェクトのプレビューは許可されるが、別プロジェクトや独自ドメインの任意サブドメインは許可しない。許可したプレビューには管理権限が及ぶため、信頼できるコードのみ配信する。

Pagesとworkers.devの構成は `ADMIN_ALLOW_CROSS_SITE=true` が必要。setupは管理画面の作成直後、updateはWorkerの再デプロイ前に不足設定を補い、secret名の存在を再確認する。既存のsecret許可リストや明示設定は上書きしない。Worker更新は --keep-vars で既存変数を保持する。ADMIN_*を手動で[vars]に設定した構成は、自動更新前に値を照合し同じ値をsecretとして登録する。手動構成では先に設定する。

```sh
pnpm exec wrangler secret put ADMIN_ORIGIN --config apps/worker/wrangler.toml
pnpm exec wrangler secret put ADMIN_ALLOW_CROSS_SITE --config apps/worker/wrangler.toml
```

`ADMIN_COOKIE_SAMESITE` は任意の Lax / Strict / None。通常は自動選択を使う。cross-siteではNoneとSecure、および明示opt-inが必要。同一サイトの独自ドメインではLaxを使える。ローカル開発では管理画面とAPIのホスト名をともにlocalhostに揃える。

更新時は0020（セッション）と0021（リンクの補助列）までmigrationを適用後、Worker→管理画面の順に配信する。新Workerは旧Bearer UIも受け付ける。新UIへ更新後は一度再ログインし、古いブラウザ保存APIキーは自動削除する。

セッションIDはランダム値で、D1にはそのハッシュだけを保存する。APIキー自体をCookieに入れない。CSRFはヘッダ・Cookie・DB内のセッションに結び付けたハッシュの一致を確認する。

ブラウザがサードパーティCookieを拒否する場合、SameSite=NoneでもPages↔workers.devのログインは成立しないことがある。管理画面/APIを同一サイトの独自ドメイン、またはWorker ASSETSの同一originで提供する。ログイン後にCookieが届くことを確認するHTTP要求を行い、失敗したら画面に案内する。実ブラウザの制限確認は配信前に必要。


## Metaの接続条件と権限（※Codex修正後の挙動）

Instagramのプロアカウント（ビジネスまたはクリエイター）を使用する。個人アカウントの場合はInstagramアプリのアカウント設定からプロアカウントへ切り替える。Facebook Pageとの紐付けはInstagram Login方式の前提にしない。

| 用途 | 確認するpermission |
|---|---|
| プロフィール・メディア取得 | instagram_business_basic |
| DMの送受信 | instagram_business_manage_messages |
| コメント・private reply | instagram_business_manage_comments（DM機能も使う場合はmanage_messagesも確認） |
| 投稿 | instagram_business_content_publish |

設定画面のアカウント追加では、User IDを空欄にするとtokenの実応答から取得する。入力した場合は一致を確認する。token更新も保存前に確認し、無効・別アカウントの場合は元のcredentialを保持する。usernameは実応答を使用する。

長期token（通常60日）を使用する。refreshは発行後24時間以上経過し、未失効であることが前提。発行直後のrefresh失敗と、/meでのtoken無効は区別する。/meだけでは寿命や全permissionは確定しない。失効・パスワード変更・checkpoint等で使えなくなった場合は、新しい長期tokenを取得して設定画面へ登録し直す。

既定Graph APIはv25.0。`IG_GRAPH_API_VERSION`で固定できる。Meta側でApp Secret Proofを必須にした場合は `IG_REQUIRE_APPSECRET_PROOF=true` と正しいInstagram App Secretを設定する。設定値はsecret管理へ置き、チャットやGitにtokenを貼らない。

アプリ側Webhookとaccount側subscribed_appsの両方を確認する。現在の標準購読はmessages、messaging_postbacks、messaging_referral、comments。ストーリーDMのメンションはmessages添付経路で処理する。legacyのmentions通知を通常DMウィンドウの開始とはみなさない。live_commentsは未対応なので購読を案内しない。

アプリのロール、tester承認、Liveモード、対象アカウントの所有・管理条件、Access LevelをMeta側で確認する。他者への提供やCloudテナント運用は、セルフホストの本人アカウント運用と同じ条件だと仮定しない。[公式資料と今回の判断](../operations/meta-api-audit-20261026.md)を参照。
