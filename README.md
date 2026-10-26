🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# IG Harness

> ### **[ブラウザでデモを見る](https://shudesu.github.io/ig-harness-oss/)** 👈

Instagram DM の完全オープンソース自動化 / マーケティングオートメーション。**A社 / B社 の無料代替**。
IG Harness本体のソフトウェア利用料は **0円** です。Cloudflareの契約・利用量、独自ドメイン、導入・保守、接続する外部AIサービスの費用は別です。Claude CodeからMCP経由で操作できます。

費用の条件は[開発元の公式料金説明](https://the-harness.com/ig-harness/#costs)で確認できます。[Cloudflare D1の無料プラン](https://developers.cloudflare.com/d1/platform/pricing/)は日次の読み書き上限に達するとクエリがエラーになり、有料プランの超過課金とは挙動が異なります。外部AIを接続する場合は、たとえば[Claudeのプラン・API料金](https://claude.com/pricing)を別に確認してください（2026年9月6日確認）。

### ▶️ [動画で見る (YouTube)](https://youtu.be/xzEanXQtlO0)

[![クリックで YouTube を再生 — IG Harness 導入の全手順](https://img.youtube.com/vi/xzEanXQtlO0/maxresdefault.jpg)](https://youtu.be/xzEanXQtlO0)

> 📖 **セットアップガイド (スクショ付き完全版)**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

**現バージョン**: v0.12.0 ・ MIT License ・ TypeScript / Cloudflare Workers + D1 + R2

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
| 月額 | $15〜 | 1〜3万円 | **0円（ソフトウェア利用料）** |
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
| Meta 審査 | 提供元の条件に従う | 提供元の条件に従う | **機能・接続対象・Access Levelにより必要** |
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
- owner用の環境APIキーを生成（DBへのowner行の作成は不要）

管理画面は完了時に表示されるPages URLです。セットアップ所要時間は権限設定・認証・ビルド環境により異なります。

### 必要なもの

- Cloudflare アカウント（無料枠で OK）
- Instagram プロアカウント（ビジネス / クリエイター）+ Meta App
- Node.js 22+ / pnpm

---

## 主要機能

### エンゲージメント（集客の主力）
- **エンゲージメントゲート** — A社 スタイルの「コメント → DM → フォロー確認 → 特典配布」ループ。フォロー未完了なら "フォローしてから戻ってきて" DM を送り、フォロー確認後に特典 DM を自動配布
- **コメント → DM 自動配布** — 特定投稿 / リールへのコメントをトリガーに DM で特典配布（全投稿 or 個別指定）
- **コメント自動リプライ** — キーワードごとの返信。ゲートのトップレベル投稿とルールのスレッド返信を扱い、対象アカウントに応じたMeta権限が必要
- **ストーリーメンション → DM** — メンション検知で自動 DM
- **DM キーワードトリガー** — 特定キーワードの DM 受信でゲート発火

### 配信
- **ステップ配信** — キーワードトリガーで時間差 DM 連続送信
- **追い DM（フォローアップドリップ）** — 特典配布後に分単位の遅延で最大 3 通まで
- **一斉配信（API/MCP）** — 最終inboundから24時間以内かつ本アプリが応答を担当する相手に限定。タグ絞り込み・予約・宛先別結果に対応
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

MetaのStandard/Advanced Accessは、対象のInstagramプロアカウントの所有・管理とApp Dashboardへの登録等で条件が変わります。全機能が無条件に審査不要とは保証しません。トップレベルコメントは審査やpermissionを回避する仕組みではありません。

自分が所有・管理し、App Dashboardに登録したプロアカウントのStandard Accessと、他者のアカウントへ提供する際のAdvanced Accessを区別してください。App Review・Business Verification・個別permissionの条件はMetaの現行資料で確認します。

ゲートはトップレベルのmention、コメントルールはスレッド返信を使用します。どちらもpermissionを回避する仕組みではありません。[Meta API監査の照合](docs/operations/meta-api-audit-20261026.md)に一次資料と今回の判断を記載しています。

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

## 運用上の権限と更新

MCPへowner/adminキーを渡すと、DM送信・一斉配信を含む管理権限を渡します。`IG_HARNESS_READ_ONLY=true` では書き込みツールを登録しません。[MCP設定](docs/manual/08-mcp.md)を確認してください。

管理画面はセットアップが表示するPages URLです。環境API_KEYがownerであり、手動でowner行をINSERTする必要はありません。更新前バックアップ、migration、暗号化鍵、24時間枠、保持期間、ログ、削除受付の運用は [レビュー対応と更新手順](docs/operations/review-remediation.md) にまとめています。脆弱性は [SECURITY.md](SECURITY.md) の非公開窓口へ報告してください。


Meta連携はInstagram Login方式です。コメントからの初回DMはprivate reply 1通で、その後の通常DMは相手の応答が必要です。既存の画像・テンプレート・特典内容は返信後まで待機します。登録時に確認するのはtokenのprofile取得とuser_idの一致であり、全permissionの保証ではありません。[Meta監査の照合と移行注意](docs/operations/meta-api-audit-20261026.md)を参照してください。
