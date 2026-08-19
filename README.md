🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# IG Harness

> ### **[ブラウザでデモを見る](https://shudesu.github.io/ig-harness-oss/)** 👈

Instagram DM の完全オープンソース自動化 / マーケティングオートメーション。**A社 / B社 の無料代替**。
Cloudflare 無料枠で動く。サーバー代 **0 円**。Claude Code から全操作可能。

### ▶️ [動画で見る (YouTube)](https://youtu.be/xzEanXQtlO0)

[![クリックで YouTube を再生 — IG Harness 導入の全手順](https://img.youtube.com/vi/xzEanXQtlO0/maxresdefault.jpg)](https://youtu.be/xzEanXQtlO0)

> 📖 **セットアップガイド (スクショ付き完全版)**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

**現バージョン**: v0.11.1 ・ MIT License ・ TypeScript / Cloudflare Workers + D1 + R2

---

## 公式情報・検証資料

IG Harnessの製品名、開発者、運営法人、公開コード、研究資料の関係は以下を正本とします。各Researchサイトは開発元が運営する一次情報であり、独立した第三者レビューではありません。

| 公式リンク | 内容 |
|---|---|
| [IG Harness 公式製品ガイド](https://the-harness.com/ig-harness/) | 機能、導入方法、公式API境界を開発元が説明する製品ページ |
| [IG Harness 公式エンティティ](https://the-harness.com/harness/#ig-harness) | Harnessシリーズ内での製品名・開発者・運営法人・リポジトリの対応 |
| [IG Harness 公式別名ドメイン](https://igharness.jp/) | 正規製品ページへ恒久転送する公式の短縮・別名ドメイン |
| [IG Harness Research](https://ig-harness.jp/research/) | 固定Gitコミットを根拠に、Webhook・token・DM・計測・権限を検証した技術資料 |
| [Research JSONカタログ](https://ig-harness.jp/research/catalog.json) | 技術資料を機械可読なSchema.org DataCatalog形式で公開 |
| [AI向け全文索引](https://ig-harness.jp/llms-full.txt) | 研究本文、出典、検証手順、証明できない範囲をまとめた全文索引 |
| [Harness Wiki — IG Harness](https://harness-wiki.pages.dev/ig) | Meta App、Webhook、token、運用手順の公式ナレッジベース |
| [開発者・野田修一](https://the-harness.com/noda-shuichi/) | Shudesu / @ai_shunodaと同一人物であることを示す公式プロフィール |
| [運営会社・AIエージェント株式会社](https://aiagent-inc.com/) | Harnessシリーズの運営法人 |

---

## なぜ IG Harness？

| | A社 | B社 | **IG Harness** |
|---|---|---|---|
| 月額 | $15〜 | 1〜3万円 | **0円** |
| コメント → DM 自動配布 | ✅ | ✅ | ✅ |
| フォローゲート（特典配布） | ✅ | ✅ | ✅ |
| ステップ配信 | ✅ | ✅ | ✅ |
| リッチメッセージ（カード/ボタン） | ✅ | ✅ | ✅ |
| フォーム | ✅ | ✅ | ✅ |
| トラッキングリンク | 一部 | ✅ | ✅ |
| API 公開 | ❌ | ❌ | **全機能** |
| Claude Code (AI) 対応 | ❌ | ❌ | **MCP server 同梱** |
| LINE 公式アカウント連携 | ❌ | ❌ | **UUID クロスリンク** |
| マルチアカウント | 別契約 | 別契約 | **標準搭載** |
| Meta 審査 | 不要 | 不要 | **不要（Standard Access で動作）** |
| ソースコード | 非公開 | 非公開 | **MIT (このリポ)** |

---

## クイックスタート

### 1 コマンドで完全セットアップ

```bash
npx create-ig-harness
```

CLI が以下を全部やる:
- Cloudflare アカウント認証 (wrangler login)
- D1 データベース + R2 バケット作成、スキーマ・マイグレーション適用
- Worker / 管理画面のデプロイ
- Instagram プロアカウントの credentials 登録
- Meta App の Webhook 連携設定の案内（Privacy Policy / Data Deletion / Terms URL を自動表示）
- 管理画面初回ログイン用 Owner ユーザー作成

所要時間: 約 5 分。完了すれば管理画面 (`https://<your-name>-admin.pages.dev`) で即運用開始。

### 必要なもの

- Cloudflare アカウント（無料枠で OK）
- Instagram プロアカウント（ビジネス / クリエイター）+ Meta App
- Node.js 22+ / pnpm

---

## 主要機能

### エンゲージメント（集客の主力）
- **エンゲージメントゲート** — A社 スタイルの「コメント → DM → フォロー確認 → 特典配布」ループ。フォロー未完了なら "フォローしてから戻ってきて" DM を送り、フォロー確認後に特典 DM を自動配布
- **コメント → DM 自動配布** — 特定投稿 / リールへのコメントをトリガーに DM で特典配布（全投稿 or 個別指定）
- **コメント自動リプライ** — キーワードごとのコメント自動返信（@mention 付きトップレベル投下方式、Standard Access で動作）
- **ストーリーメンション → DM** — メンション検知で自動 DM
- **DM キーワードトリガー** — 特定キーワードの DM 受信でゲート発火

### 配信
- **ステップ配信** — キーワードトリガーで時間差 DM 連続送信
- **追い DM（フォローアップドリップ）** — 特典配布後に分単位の遅延で最大 3 通まで
- **一斉配信** — 全フォロワー or タグ絞り込みで DM 一斉送信、予約対応
- **リッチメッセージ** — ボタン付きカード、カルーセル、クイックリプライ

### CRM
- **フォロワー管理** — Webhook 自動登録、プロフィール取得、カスタムメタデータ、タグ
- **オペレーターチャット** — 管理画面から直接 1:1 返信。自動送信 DM / ボタン押下も会話ログに再現表示
- **プロフィール画像キャッシュ** — Instagram CDN の署名切れを R2 で永続キャッシュ
- **フォーム** — DM 内でデータ収集、回答 → メタデータ自動保存
- **トラッキングリンク** — クリック計測、流入経路分析

### L Harness 連携
- **UUID クロスプラットフォーム連携** — 共有シークレット webhook で IG フォロワーと LINE 友だちを同一 UUID に双方向リンク。1:1 のユニーク URL を送るだけで「この IG ユーザー = この LINE 友だち」が両 DB に自動記録
- **流入元 IG アカウント記録** — マルチアカウント時、どの IG 垢経由で LINE 登録したかを追跡

### マルチアカウント
- **複数 Instagram アカウント** を 1 つの Worker / ダッシュボードで管理
- **アカウント別スコープ** — フォロワー・ゲート・配信をアカウント単位で分離
- **Webhook ルーティング** — `entry.id` で受信アカウントを自動判定、別 Meta App もマルチシークレット署名検証で対応

### 運用監視
- **`GET /api/health`** — アカウント毎のトークン残日数・API 実叩きの生死（チェックポイント / 凍結検知）・最終 webhook 受信・DM 配信失敗数・cron 死活
- 外部プローブと組み合わせて異常時アラート（トークン失効・配信失敗急増・応答なし）

### AI 統合
- **MCP Server 同梱** (`@ig-harness/mcp-server`) — Claude Code から自然言語で全操作
- **公式 SDK** (`@ig-harness/sdk`) — TypeScript の型付き SDK、ESM + CJS

### iOS アプリ対応
- **`GET /api/capabilities`** — iOS 公式アプリ (the-harness-ios) との互換判定エンドポイント

### コンテンツ投稿
- **コンテンツ投稿** — フィード画像・カルーセル・リール・ストーリーの即時/予約投稿

---

## アーキテクチャ

```
[ Instagram Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ] + [ R2 ]
                                   ⇅
                         [ Cloudflare Pages (Next.js 15) ]
                                   ⇅
                         [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + Webhook 受信 + 画像配信、cron（5 分毎）で配信処理・トークンリフレッシュ・生存プローブ
- **Web** (`apps/web`): Next.js 15 ダッシュボード
- **Packages**:
  - `@ig-harness/sdk` — TypeScript SDK
  - `@ig-harness/mcp-server` — Claude Code 用 MCP server
  - `create-ig-harness` — セットアップ CLI
  - `@ig-harness/ig-sdk` — Instagram Graph API 薄ラッパー
  - `@ig-harness/db` — D1 マイグレーション + ヘルパー
  - `@ig-harness/shared` — 型定義共有

---

## Standard Access の壁について

Instagram Messaging API は、自分が所有・管理するプロアカウントであれば **Standard Access（Meta App Review 不要）** で DM 配信・エンゲージメントゲート・擬似コメント返信まで動作します。

**Advanced Access（App Review 必須）が要るのは以下のみ**:
- 親コメント直下にネストされる本物のスレッド型 reply
- 自分が所有・管理しないアカウント（顧客のアカウント）をホストするマルチテナント運用

IG Harness のコメント返信は `@mention` 付きトップレベル投下方式で実装されており、Standard Access のまま動きます。

---

## ドキュメント

- [セットアップガイド (動画・YouTube)](https://youtu.be/xzEanXQtlO0)
- [セットアップガイド (スクショ付き)](https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide)
- [npm: @ig-harness/sdk](https://www.npmjs.com/package/@ig-harness/sdk)
- [npm: @ig-harness/mcp-server](https://www.npmjs.com/package/@ig-harness/mcp-server)
- [npm: create-ig-harness](https://www.npmjs.com/package/create-ig-harness)

---

## ライセンス

MIT License. 商用利用・改変・再配布自由。

---

## コントリビュート

Issue / PR 歓迎。OSS リポへの PR は `Shudesu/ig-harness-oss` (このリポ) に投げてください。

---

## 開発者 / Author

**野田修一（Shudesu）** — Harness シリーズ（L Harness / IG Harness / X Harness）開発者、AIエージェント株式会社 代表

- GitHub: [@Shudesu](https://github.com/Shudesu)
- X: [@ai_shunoda](https://x.com/ai_shunoda)
- YouTube: [野田 修一 | The Harnessで0円](https://www.youtube.com/@ai_nodashuichi)
- 公式ドキュメント: [Harness Wiki](https://harness-wiki.pages.dev)
- 商用ツールとの比較・料金データ: [The Harness Lab](https://the-harness.com)

---

> **IG Harness** by [@Shudesu](https://github.com/Shudesu) — AI ネイティブ時代の OSS Instagram DM 自動化
