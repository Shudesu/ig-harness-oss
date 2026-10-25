# セルフホストのセットアップ

Node.js 22とpnpm 9.15.4、本人のCloudflareアカウント、Instagramプロアカウントを用意する。対象リポジトリは `Shudesu/ig-harness-oss`。`instagram-harness-oss` は別プロジェクト。

```sh
git clone https://github.com/Shudesu/ig-harness-oss.git
cd ig-harness-oss
pnpm install --frozen-lockfile
pnpm --filter create-ig-harness build
pnpm deploy:setup
```

この実装は **Instagram API with Instagram Login** を利用する。Facebook Page tokenを求める古い案内は使用しない。MetaアプリのInstagramログイン用API設定から、Instagram App SecretとInstagramの長期access tokenを取得する。トークンは通常IGAAから始まるが、接頭辞だけでは判定せず、ウィザードが `graph.instagram.com/v21.0/me?fields=user_id,username` で確認する。`IG_USER_ID` は応答の `user_id`。`id` を手入力して取り違えない。

ウィザードはD1 migration、R2、Worker、Pages管理画面、必要なsecret、アカウント単位のsubscribed_apps設定を処理する。App側のWebhook callback/verify tokenと購読フィールドは表示される手順でも確認する。`messages`、`messaging_postbacks`、`messaging_referral`、`comments` を使用する。ストーリーメンションのDM添付もmessages経路で扱う。

Instagram側でメッセージへのアクセス許可、アプリのテスター参加、開発モードで許可されたアカウントを確認する。LiveモードやAdvanced Accessの要否は実際の権限・用途に従う。[Meta公式Instagram Login資料](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)を参照。

管理画面は完了時に表示されたPages URL。環境 `API_KEY` がowner権限なので、DBにownerを直接INSERTしない。追加staffはAPIで作る。APIキーはブラウザセッション内だけに保存され、閉じた後は再ログインする。

`.ig-harness-setup.json` は失敗時の再開用秘密を含み0600。成功後は削除される。`.ig-harness-deployed.json` と生成MCP設定も秘密を含むためGitへ入れない。`TOKEN_ENCRYPTION_KEY` を保存せず捨てたり、更新のたびに再生成したりしない。

手動構成では `.env.example` と [運用手順](../operations/review-remediation.md) の必須変数、CORS、migration手順を確認する。`schema.sql` 単体で導入を完了としない。
