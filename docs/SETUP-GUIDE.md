# Instagram Harness セットアップガイド（実体験ベース）

> 2026-03-30〜04-02 の実際のセットアップで踏んだ罠と解決策を全て記録。

📖 **スクショ付き完全版ガイド**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

## 1. Meta App 作成

### 手順
1. https://developers.facebook.com → マイアプリ → アプリを作成
2. ユースケース: **「Instagramでメッセージとコンテンツを管理」**
3. アプリ名: 任意（例: `i-harness`）
4. ビジネス: 自分のビジネスを選択

### 注意点
- 「その他」ユースケースではなく、Instagram専用のユースケースを選ぶ
- アプリ作成後、Instagram APIダッシュボードが自動で表示される

## 2. Instagram APIセットアップ

### ステップ2: アクセストークン生成
1. 「Instagramテスターの役割を割り当て」→ 自分のIGビジネスアカウントをテスターに追加
2. IGアプリ側でテスター招待を承認（設定 → ウェブサイトのアクセス許可 → テスター招待）
3. 「トークンを生成」ボタンでアクセストークン取得

### ステップ3: Webhook設定
- コールバックURL: `https://your-worker.workers.dev/webhook`
- Verify Token: 任意の文字列（Workerのシークレットと一致させる）
- サブスクライブするフィールド: `messages`, `messaging_postbacks`, `messaging_referral`, `comments`, `mentions`

### 罠: アカウントレベルのサブスクリプション
Meta Developer ConsoleのWebhookフィールド設定（アプリレベル）とは別に、**アカウントレベルのサブスクリプション**が必要:

```bash
curl -X POST "https://graph.instagram.com/v25.0/{IG_USER_ID}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_referral,comments,mentions&access_token={TOKEN}"
```

これを忘れるとWebhookが届かない。

## 3. アプリ公開

### 必要なもの
- **プライバシーポリシーURL**: Worker に `/privacy-policy` エンドポイントを追加
- **データ削除コールバックURL**: `/data-deletion` エンドポイント
- **アプリアイコン**: 1024x1024 PNG
- **カテゴリ**: ビジネス

### 罠: プライバシーポリシーURLの認証
`/privacy-policy` が Worker の auth middleware でブロックされる。auth スキップリストに追加必須:
```typescript
path === '/privacy-policy' ||
path === '/data-deletion' ||
path === '/connect' ||
```

### 罠: 「プライバシーポリシーのURLが無効」エラー
Meta がキャッシュしてる場合がある。URL パスを変えて再試行（例: `/privacy` → `/privacy-policy`）。

### アプリレビューは原則不要 (本物のスレッド型 reply を使うときのみ必要)
> 「自分のInstagramビジネスのためにのみ構築する場合は、このステップはスキップすることができます。」

ig-harness が使う API は **DM 配信 / Webhook 受信 / 自分のメディアへのコメント投下 (`POST /{media_id}/comments`)** まで全て **Standard Access** で動くため、公開トグル押すだけで運用開始できる。

例外: **本物のスレッド型 reply** (`POST /{ig-comment-id}/replies` で外部ユーザーのコメント直下にネスト返信) を使う場合のみ、Meta App Review を申請して `instagram_business_manage_comments` の **Advanced Access** を取得する必要がある。Tester 追加 + token 再発行でも回避不可 (2026-04-26 検証済み)。

ig-harness の `comment_reply_text` 機能は `postCommentToMedia` (= トップレベル + @mention 投下) で実装されているため、Standard Access のままで動作する。投稿位置が IG UI 上「投稿全体のコメント欄」に並ぶ点だけ留意 (親コメント直下のスレッド返信ではない)。

## 4. ManyChat との共存問題

### 罠: ManyChatがWebhookを奪う
ManyChatが接続されていると、**ManyChatがプライマリレシーバー**としてWebhookを受け取り、Instagram Harnessには `standby` イベントしか来ない。

### 解決策
1. ManyChatのIG連携を**完全に削除**（ManyChatの設定画面 + Instagramアプリの接続済みアプリ + Facebookのビジネス統合）
2. サブスクリプションを再登録:
```bash
# 一度全削除
curl -X DELETE "https://graph.instagram.com/v25.0/{IG_USER_ID}/subscribed_apps?access_token={TOKEN}"

# 再登録
curl -X POST "https://graph.instagram.com/v25.0/{IG_USER_ID}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_referral,comments,mentions&access_token={TOKEN}"
```

### 罠: ManyChatのリンク解除後もstandbyが続く
ManyChatのIGリンクを解除しただけでは不十分。以下も確認:
- Instagramアプリ → 設定 → 接続済みアプリ → ManyChatを削除
- Facebookアカウント → 設定 → ビジネス統合 → ManyChatを削除

## 5. DM送信の問題

### 罠: `error_subcode: 2534014`「ユーザーが見つかりません」
**原因**: standby モードで受信した IGSID はアプリスコープが違う。プライマリレシーバーでないとDM送信できない。

### 罠: `error_subcode: 2534037`「スレッド所有者ではない」
**原因**: Handover Protocol でプライマリレシーバーが別アプリ（ManyChatの残骸）に設定されていた。

### 解決策: ルーティング設定
Meta Developer Console → Instagram API ダッシュボード → **ルーティング設定** で自分のアプリをプライマリレシーバーに設定。

### 罠: 新規フォロワーへの自動DM
Instagram API の制限で、**ユーザーが先にDMを送ってこないと24時間ウィンドウが開かない**。フォローされただけでは自動DMは送れない。日本リージョン固有の制限ではなく、グローバルな制限。

代替: **コメントトリガー → DM** が主流。

## 6. Cloudflare Workers デプロイ

### 罠: `.wrangler/deploy/config.json` のキャッシュ
LINE Harness からフォークした場合、古い deploy config が残る。デプロイ先が `line-harness` になってしまう。

**解決**: `.wrangler/deploy/config.json` を削除してから `wrangler deploy`。

### 罠: `dist/` のビルドキャッシュ
コード修正後も古いバンドルがデプロイされる場合がある。

**解決**: `dist/` を削除して `wrangler deploy`。

### 罠: `[assets]` セクションの `directory` 不足
wrangler.toml に `[assets]` セクションがあるが `directory` が指定されていないとエラー。Admin UI を別デプロイ（CF Pages）にするなら `[assets]` をコメントアウト。

## 7. D1 スキーマの罠

### LINE Harness フォーク由来のカラム名不一致
フォーク元のDBパッケージ（`packages/db/src/`）が古いテーブル名・カラム名を参照する:

| 古い（LINE Harness） | 新しい（IG Harness） |
|---|---|
| `friends` テーブル | `followers` テーブル |
| `friend_tags` | `follower_tags` |
| `friend_scenarios` | `follower_scenarios` |
| `friend_id` カラム | `follower_id` カラム |
| `display_name` | `name` |
| `picture_url` | `profile_pic_url` |
| `user_id` | `igsid` |
| `message_content` | `body` |
| `current_step_order` | `current_step` |
| `started_at` | `enrolled_at` |
| `next_delivery_at` | `next_step_at` |

**教訓**: フォーク後にDBパッケージの全ファイルを grep して置換すること。`messages_log` の `friend_id` が最も頻出。

### 存在しないテーブル参照
LINE Harness にあってIG Harnessにないテーブル:
- `chats` — `upsertChatOnMessage` が呼ばれてエラー
- `scoring_rules` — cron でエラー（機能に影響なし）
- `automations` — cron でエラー（機能に影響なし）
- `notification_rules` — cron でエラー（機能に影響なし）

`webhook.ts` から `upsertChatOnMessage` の呼び出しを削除すること。

### `comment_rules` の `trigger_type` カラム
LINE Harness の `auto_replies` にあった `trigger_type` が `comment_rules` には存在しない。`WHERE trigger_type = 'dm_keyword'` を削除。

## 8. Instagram API エンドポイント

### DM送信
```
POST /me/messages
Authorization: Bearer {IG_ACCESS_TOKEN}
Content-Type: application/json

{"recipient":{"id":"{IGSID}"},"message":{"text":"Hello!"}}
```

### コメントリプライ
```
POST /{comment_id}/replies
Authorization: Bearer {IG_ACCESS_TOKEN}

{"message":"@username ありがとう！"}
```

### 投稿一覧取得
```
GET /me/media?fields=id,caption,timestamp,permalink&limit=10
Authorization: Bearer {IG_ACCESS_TOKEN}
```

### ユーザープロフィール取得
```
GET /{IGSID}?fields=id,username,name,profile_pic
Authorization: Bearer {IG_ACCESS_TOKEN}
```

## 9. チェックリスト

### デプロイ前
- [ ] D1 データベース作成 (`wrangler d1 create instagram-harness`)
- [ ] R2 バケット作成 (`wrangler r2 bucket create instagram-harness-images`)
- [ ] スキーマ適用 (`wrangler d1 execute instagram-harness --remote --file=packages/db/schema.sql`)
- [ ] シークレット設定（IG_APP_SECRET, IG_ACCESS_TOKEN, IG_USER_ID, IG_VERIFY_TOKEN, API_KEY）
- [ ] `.wrangler/deploy/config.json` 削除（フォーク時）
- [ ] `dist/` 削除（フォーク時）

### Meta Developer Console
- [ ] Meta App 作成（Instagram ユースケース）
- [ ] テスター追加＆承認
- [ ] アクセストークン生成
- [ ] Webhook URL 設定（コールバック + Verify Token）
- [ ] Webhook フィールドサブスクリプション（messages, messaging_postbacks, messaging_referral, comments, mentions）
- [ ] アカウントレベルサブスクリプション（API で POST）
- [ ] プライバシーポリシーURL 設定
- [ ] データ削除URL 設定
- [ ] アプリアイコンアップロード
- [ ] アプリ公開
- [ ] ルーティング設定（プライマリレシーバー）

### 動作確認
- [ ] Webhook 検証（`hub.challenge` テスト）
- [ ] DM 受信 → フォロワー登録
- [ ] DM 送信（テキスト）
- [ ] コメント → DM 自動送信
- [ ] コメント → コメントリプライ
- [ ] シナリオ配信
