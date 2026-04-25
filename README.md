# IG Harness

IG DM 向けオープンソースの自動化 / マーケティングオートメーション。
**ManyChat・iステップ の代替** として、Cloudflare 上でセルフホストし月額0円〜で運用できます。

## 特徴

- **エンゲージメントゲート（NEW）** — ManyChat スタイルの「フォロー → コメント → DM 配布」ループ。フォロー未完了なら "フォローしてから戻ってきて" DMを送り、フォロー確認後に特典DMを自動配布
- **LINE Harness との UUID クロスプラットフォーム連携（NEW）** — 共有シークレット webhook で IG ユーザーと LINE 友だちを同一UUIDに紐付け、IG → LINE の導線を1本化
- **キャンペーンダッシュボード（NEW）** — `/campaigns` でゲートの CRUD + 実行分析（フォロー通過率 / DM配布数 / LINE紐付け数）
- **コメント → DM 自動配布** — 特定投稿/リールへのコメントをトリガーに DM で特典配布
- **コメント自動リプライ** — キーワードごとのコメント自動返信
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
| Meta Review 不要 | ✅ (dev mode) | — | — |

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

**Meta レビュー不要**: Dev Mode（テスター追加）で運用するため、本番 Meta App Review を経由せずに即日デプロイできます。

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
