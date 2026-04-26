# Instagram Harness — 最短セットアップ（15分）

> この手順通りに上から順にやれば、罠を踏まずにDM自動化が動く。

📖 **スクショ付き完全版ガイド**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

## 前提条件
- Instagramビジネスアカウント（プロアカウント）
- Facebookアカウント（IGビジネスアカウントにリンク済み）
- Cloudflareアカウント
- Node.js 20+, pnpm, wrangler CLI

---

## Step 1: Meta App作成（3分）

1. https://developers.facebook.com → **マイアプリ** → **アプリを作成**
2. ユースケース: **「Instagramでメッセージとコンテンツを管理」** を選択
3. アプリ名: 任意 → **作成**
4. Instagram APIダッシュボードが開く

**ここで絶対にやること:**

5. 左サイドバー → **アプリの設定 → ベーシック** → **App Secret** をコピー（後で使う）
6. 同じ画面の **Instagram App Secret** もコピー
7. **Instagram App ID** もコピー

## Step 2: テスター追加 & トークン生成（2分）

1. Instagram APIダッシュボードの **ステップ2**
2. **「Instagramテスターの役割を割り当て」** → 自分のIGアカウントを追加
3. **IGアプリ**（スマホ）→ 設定 → ウェブサイトのアクセス許可 → テスター招待 → **承認**
4. ダッシュボードに戻って **「トークンを生成」** → コピー

**メモしておくもの:**
```
IG_USER_ID: （ステップ2のアカウント横に表示される数字）
IG_ACCESS_TOKEN: （生成したトークン）
IG_APP_SECRET: （Step 1でコピーしたInstagram App Secret）
```

## Step 3: Worker デプロイ（5分）

```bash
# クローン
git clone https://github.com/Shudesu/instagram-harness.git
cd instagram-harness/apps/worker

# D1作成
wrangler d1 create instagram-harness
# → 表示された database_id を wrangler.toml に設定

# R2作成
wrangler r2 bucket create instagram-harness-images

# スキーマ適用
wrangler d1 execute instagram-harness --remote --file=../../packages/db/schema.sql

# シークレット設定（1つずつ実行）
echo "YOUR_IG_APP_SECRET" | wrangler secret put IG_APP_SECRET
echo "YOUR_IG_ACCESS_TOKEN" | wrangler secret put IG_ACCESS_TOKEN
echo "YOUR_IG_USER_ID" | wrangler secret put IG_USER_ID
echo "my-verify-token-2026" | wrangler secret put IG_VERIFY_TOKEN
echo "$(openssl rand -hex 32)" | wrangler secret put API_KEY

# デプロイ
wrangler deploy
# → 表示されたURL（例: https://instagram-harness.xxx.workers.dev）をメモ
```

**重要:** フォーク元の `dist/` や `.wrangler/deploy/config.json` が残ってたら削除してからデプロイ。

## Step 4: Webhook設定（2分）

### 4a: コールバックURL設定
Instagram APIダッシュボード → **ステップ3**:
- コールバックURL: `https://YOUR-WORKER.workers.dev/webhook`
- トークンを認証: `my-verify-token-2026`（IG_VERIFY_TOKENと同じ値）

### 4b: フィールドサブスクリプション
以下を全て **サブスクリプション登録**:
- `messages`
- `messaging_postbacks`
- `comments`
- `live_comments`
- `mentions`

### 4c: アカウントレベルサブスクリプション（最重要）
**Meta Consoleの設定だけでは不十分。** API でも登録が必要:

```bash
curl -X POST "https://graph.instagram.com/v25.0/YOUR_IG_USER_ID/subscribed_apps?subscribed_fields=messages,messaging_postbacks,comments,mentions&access_token=YOUR_TOKEN"
```

`{"success":true}` が返ればOK。

### 4d: Webhookサブスクリプションのトグル
ステップ2のアカウント横の **Webhookサブスクリプション** トグルを **オン** にする。

## Step 5: アプリ公開（2分）

### 5a: 公開に必要な設定
左サイドバー → **アプリの設定 → ベーシック**:
- プライバシーポリシーURL: `https://YOUR-WORKER.workers.dev/privacy-policy`
- データの削除手順URL: `https://YOUR-WORKER.workers.dev/data-deletion`
- アプリアイコン: 1024x1024のPNG
- カテゴリ: ビジネス

### 5b: 公開
ページ上部の **開発 → 公開** トグルを切り替え。

> 「自分のビジネスのためにのみ構築する場合、アプリレビューはスキップできます」

ℹ️ ig-harness の機能は DM 配信 / Webhook 受信 / `comment_reply_text` (=トップレベル+@mention 擬似 reply) まで全て Standard Access で動くので App Review なしで即運用可能。**例外**: 親コメント直下の **本物のスレッド型 reply** (`POST /{ig-comment-id}/replies`) を使う場合のみ、Meta App Review を申請して Advanced Access が必要。

### 5c: ルーティング設定（ManyChat使ったことある人は必須）
Instagram APIダッシュボード → **ルーティング設定** → 自分のアプリをプライマリレシーバーに。

これをしないと `「スレッド所有者ではない」` エラーでDM送信できない。

## Step 6: 動作確認（1分）

### Webhook確認
```bash
curl "https://YOUR-WORKER.workers.dev/webhook?hub.mode=subscribe&hub.verify_token=my-verify-token-2026&hub.challenge=test123"
# → test123 が返ればOK
```

### DM受信テスト
別のIGアカウントから自分のIGビジネスアカウントにDMを送る。

```bash
# フォロワー確認
wrangler d1 execute instagram-harness --remote --command "SELECT * FROM followers"
```

### DM送信テスト
```bash
curl -X POST "https://graph.instagram.com/v25.0/me/messages" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipient":{"id":"IGSID_FROM_FOLLOWERS"},"message":{"text":"Hello!"}}'
```

---

## よくあるエラーと解決策

| エラー | 原因 | 解決 |
|---|---|---|
| Webhookが届かない | アカウントレベルサブスクリプション未設定 | Step 4c を実行 |
| Webhookが届かない | アプリが開発モード | Step 5 で公開 |
| `standby` で届く | 他アプリがプライマリレシーバー | Step 5c ルーティング設定 |
| `2534014` ユーザーが見つからない | プライマリレシーバーでない | Step 5c ルーティング設定 |
| `2534037` スレッド所有者ではない | ルーティング設定未完了 | Step 5c ルーティング設定 |
| `401 Unauthorized` on /privacy-policy | auth middleware がブロック | auth.ts のスキップリストに追加 |
| D1エラー `no such table: friends` | カラム名が旧スキーマ | `friends` → `followers` に修正 |
| D1エラー `no such column: friend_id` | DBパッケージ未修正 | 全SQLの `friend_id` → `follower_id` |
| 新規フォロワーに自動DM送れない | IG APIの仕様（全リージョン共通） | コメントトリガーを使う |

## 次にやること

1. **コメントルール作成** — D1に直接INSERT or MCP or 管理画面
2. **シナリオ作成** — キーワードトリガーのステップ配信
3. **LINE Harness連携** — LIFF URL に `ref=ig_{{igsid}}` で流入経路トラッキング
