# IG Harness

IG DM 向けオープンソースの自動化 / マーケティングオートメーション。
**ManyChat・iステップ の代替** として、Cloudflare 上でセルフホストし月額0円〜で運用できます。

> 📖 **セットアップガイド (スクショ付き完全版)**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>
>
> Cloudflare アカウント作成 → Meta App 設定 → Webhook 連携まで、つまずきやすいポイントを画像付きで解説しています。

## 特徴

- **エンゲージメントゲート（NEW）** — ManyChat スタイルの「フォロー → コメント → DM 配布」ループ。フォロー未完了なら "フォローしてから戻ってきて" DMを送り、フォロー確認後に特典DMを自動配布
- **LINE Harness との UUID クロスプラットフォーム連携（NEW）** — 共有シークレット webhook で IG ユーザーと LINE 友だちを同一UUIDに紐付け、IG → LINE の導線を1本化
- **キャンペーンダッシュボード（NEW）** — `/campaigns` でゲートの CRUD + 実行分析（フォロー通過率 / DM配布数 / LINE紐付け数）
- **コメント → DM 自動配布** — 特定投稿/リールへのコメントをトリガーに DM で特典配布
- **コメント自動リプライ** — キーワードごとのコメント自動返信 *(@mention 付きトップレベル投下方式。本物のスレッド型 reply は Meta App Review / Advanced Access 必須)*
- **ステップ配信** — キーワードトリガーで時間差 DM 連続送信
- **リッチメッセージ** — ボタン付きカード、カルーセル、クイックリプライ
- **一斉配信** — 全フォロワー or タグ絞り込みで DM 一斉送信
- **フォーム** — DM 内でデータ収集
- **トラッキングリンク** — クリック計測、流入経路分析
- **ストーリーメンション → DM** — メンション検知で自動 DM
- **SDK** — `@ig-harness/sdk` でプログラマティックに全機能を操作
- **MCP Server** — `@ig-harness/mcp-server` で Claude Code から自然言語操作
- **管理画面** — Next.js 15 ダッシュボード

## 競合比較

| 機能 | IG Harness | ManyChat | iステップ |
|------|------------|----------|-----------|
| 月額料金 | **$0〜** | $15〜 | ¥14,800〜 |
| エンゲージメントゲート | ✅ | ✅ | ✅ |
| フォロー check ループ | ✅ | ✅ (Pro) | ✅ |
| LINE クロス連携 | ✅ | ❌ | ❌ |
| コメント → DM | ✅ | ✅ | ✅ |
| ストーリーメンション | ✅ | ✅ | ✅ |
| SDK | ✅ | ❌ | ❌ |
| MCP (AI連携) | ✅ | ❌ | ❌ |
| セルフホスト | ✅ | ❌ | ❌ |
| オープンソース | ✅ | ❌ | ❌ |
| Standard Access で運用可 | ✅ (擬似コメント返信含む) | ❌ (Advanced 必須) | ❌ (Advanced 必須) |
| 本物のスレッド型 reply | App Review 必須 | ✅ | ✅ |

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| API / Webhook | Cloudflare Workers + Hono |
| データベース | Cloudflare D1 (SQLite) |
| 画像ホスティング | Cloudflare R2 |
| 定期実行 | Workers Cron Triggers |
| 管理画面 | Next.js 15 (App Router) + Tailwind CSS |
| SDK | TypeScript, ESM + CJS |
| MCP Server | Model Context Protocol, `@ig-harness/sdk` ベース |
| IG連携 | Instagram Graph API (Meta Dev Mode) |

## Meta App Review について

| 機能 | 必要なアクセスレベル |
|------|----------------------|
| DM 自動配布、ステップ配信、一斉配信、フォーム、トラッキングリンク | **Standard Access** (App Review 不要) |
| Webhook 受信 (コメント / DM / ストーリーメンション) | **Standard Access** |
| エンゲージメントゲートのフォロー check / DM 配布 / LINE 連携 | **Standard Access** |
| **コメント自動リプライ** (`comment_reply_text`) | **Standard Access** *(@mention 付きトップレベル投下、`POST /{media_id}/comments` 経由)* |
| **本物のスレッド型 reply** (親コメント直下にネストされる返信) | **Advanced Access (Meta App Review 通過必須)** |

**実装ノート**: ig-harness は `comment_reply_text` 機能を `postCommentToMedia` (= `POST /{ig-media-id}/comments`) で実装しているため、Standard Access のままで動作します。投稿される位置は IG UI 上「投稿全体のコメント欄に新しいコメントとして並ぶ」形になり、親コメント直下の **スレッド返信ではない** 点だけ留意してください (UX 的には @mention 通知で commenter には届きます)。

`POST /{ig-comment-id}/replies` (本物のスレッド型 reply) を使いたい場合のみ Meta App Review を申請して `instagram_business_manage_comments` の **Advanced Access** を取得してください。Tester 追加 + token 再発行でも回避不可 (2026-04-26 検証済み)。

## アーキテクチャ

```
Instagram (Graph API) ←→ CF Workers (Hono) → D1
          │                     │
          ▼                     ▼
     Webhook 受信          Cron Triggers
     (comment/DM/          ・ゲートフォロー check
      story mention)        ・ステップ配信
                            ・スケジュール送信
                                │
                                ▼
                               R2 (画像)

Next.js 15 (Dashboard) → Workers API → D1
@ig-harness/sdk → Workers API → D1
@ig-harness/mcp-server → Workers API → D1

         ┌────────────── UUID 共有 webhook ──────────────┐
         ▼                                                ▼
  IG Harness ←──────── 共有シークレット ────→ LINE Harness
   (IG friend)                                  (LINE friend)
         └──────────── 同一 UUID に紐付け ────────────────┘
```

## クイックスタート

ワンコマンドで新規プロジェクトを生成できます。

```bash
npx create-ig-harness my-ig-harness
cd my-ig-harness
pnpm install
```

その後、対話プロンプトに従って Cloudflare / Meta の認証情報を入力すれば、Worker + D1 + R2 + ダッシュボードが一括デプロイされます。

詳細は以下を参照してください:

- **セットアップ**: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)
- **詳細セットアップガイド**: [`docs/SETUP-GUIDE.md`](docs/SETUP-GUIDE.md)
- **API リファレンス**: [`docs/API.md`](docs/API.md)
- **コントリビューション**: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **変更履歴**: [`CHANGELOG.md`](CHANGELOG.md)

## エンゲージメントゲート（ManyChat スタイル）

IG Harness の目玉機能。投稿 / リールに特定キーワードでコメントしたユーザーをトリガーに、フォロー状態を確認 → 未フォローなら "フォローしてね" DM → フォロー後に特典 DM を自動配布します。

```
[ユーザーがリールにコメント "欲しい"]
            │
            ▼
 [Harness Webhook 受信]
            │
            ▼
  ┌─── follows me? ───┐
  │                   │
  NO                 YES
  │                   │
  ▼                   ▼
[follow gate DM]   [reward DM + 特典リンク]
  │                   │
  ▼                   ▼
 Cron が定期的に     [LINE Harness に UUID 同期]
 再 check して        → LINE でも同じ人として追跡可能
 フォロー済みに
 なったら reward DM
```

ダッシュボードの `/campaigns` からゲートの作成 / 編集 / 分析 / 削除ができます。

## LINE Harness 連携

[LINE Harness](https://github.com/Shudesu/line-harness-oss) と共有シークレット webhook で連携し、IG 経由で獲得したユーザーを LINE の友だち情報と同一 UUID で紐付けできます。これにより:

- IG コメント → DM で LINE 登録リンク配布 → LINE 登録時に UUID 紐付け
- クロスプラットフォームで "同一ユーザー" の行動分析
- IG ゲート通過数と LINE 登録数の相関を dashboard で可視化

## ライセンス

MIT License — 商用利用可、再配布可。詳細は [`LICENSE`](LICENSE) を参照。

## コントリビューション

Pull Request 歓迎です。開発環境のセットアップと PR ガイドラインは [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。
