# Changelog

## [0.10.2] - 2026-07-07

### Fixed
- /chats の会話一覧が「登録の新しい100人」固定で、既存フォロワーからの
  新着 DM が一覧に浮上しなかった問題: `/api/friends?sort=recent`
  （最終メッセージ時刻の降順、メッセージなしは末尾）を追加し chats が使用

## [0.10.1] - 2026-07-07

### Fixed
- アカウントスイッチャーに生の ig_user_id が表示される問題: 5分毎の
  生存プローブ（GET /me）の応答から `ig_accounts.username` を自動補完・
  追従（初回セット + リネーム追随）。表示は常に `@username`

## [0.10.0] - 2026-07-07

### Added
- **/chats がユーザーの実際に見た DM を再現**: リッチメッセージ送信を
  `{"kind":"rich","blocks":[...]}` として記録し、チャットで画像サムネ・タイトル・
  ボタンピル付きのミニカード表示（`RichBlocksCompact`）。ボタン押下は IG と同じく
  ユーザー側バブル（ラベル + 🔘ボタン押下）で交互に流れる
- **サイドバーの常時表示アカウントスイッチャー**: line-harness-oss と同じ
  インタラクション（アバター + 名前 + シェブロン → ドロップダウン、選択中に
  チェックマーク）。ブランドカラーは IG ピンク

### Changed
- ゲート送信ログの body 規約: リッチ送信は `[リッチメッセージ] ...` の
  プレースホルダをやめてブロック JSON を保存（プレーンテキスト送信は従来通り）

## [0.9.1] - 2026-07-07

### Fixed（OSS コミュニティ PR の逆マージ — 6/11 の sync で消えていた分を復旧）
- OSS PR #4: create CLI とパッケージメタデータの堅牢化
- OSS PR #5: tracked-link クリックの `?ig=` アトリビューション修正
- OSS PR #7: engagement gate テストベースライン復旧（既知の1件失敗が解消）
- OSS PR #9: assets binding 欠落時のガード
- OSS PR #10: MCP / worker の typecheck ベースライン復旧（16件のエラーが解消）
- OSS PR #11: create-ig-harness update / wrangler フローの堅牢化

### Added
- OSS PR #12: `GET /api/capabilities` — IG コネクタ能力の公開エンドポイント

### Changed
- sync-oss.sh: canonical スタックの識別子を placeholder 化リストに追加

## [0.9.0] - 2026-07-07

### Added
- **運用監視基盤**
  - `GET /api/health`（Bearer 認証）: アカウント毎のトークン残日数・**API 実叩きの生死
    （`token_api_ok`、cron が 5 分毎に `GET /me` でプローブ）**・最終 webhook 受信・
    当日 DM 配信失敗数、cron 最終実行、db_ok を返す。D1 障害時も 200 + `db_ok:false`
  - 認証は env `API_KEY` 照合を DB 照合より先に（D1 が死んでいても監視可能）
  - 計測は `integration_settings` の `health:*` キー（新テーブルなし）
- **プロフィール画像の永続キャッシュ**: `GET /images/profile-pics/:igsid` が
  R2 にオンデマンドキャッシュ（30日 TTL、失敗時は stale 供給）。IG CDN の署名切れ
  403 を解消。admin は `FollowerAvatar`（イニシャルフォールバック付き）で表示
- **ゲート DM の会話ログ**: エンゲージメントゲートの CTA / リマインダー / 特典 /
  フォローアップ送信と、ユーザーのボタン押下を `messages_log` に記録
  （`trigger_source='gate'`、migration `0016` で CHECK 制約拡張）。/chats で
  ユーザーの進行度が見えるように

### Changed
- Admin のブランド刷新: SVG ブランドマーク（旧・太字テキストバッジ廃止）、
  名称を IG Harness に統一、フッターに実バージョン表示、塗りつぶし系
  ナビアイコン 2 個を線画に統一

### Fixed
- CF Workers の fire-and-forget が drop され得る問題: cron 記録 / webhook 受信記録は
  `waitUntil` 登録、DM 失敗カウンタは await（いずれも失敗しても本処理を壊さない）
- 未シードのデプロイが `ok:true` を返す問題（0 アカウント = unhealthy）
- 残り 24h 未満の有効トークンが `ok:false` になる floor バグ

## [0.6.0] - 2026-06-11

### Added
- **マルチアカウント対応（1 Worker で複数 IG ビジネスアカウント）**
  - 新テーブル `ig_accounts`（migration `0014_ig_accounts.sql`）。アカウントごとに
    access token / 任意の app_secret・verify_token（別 Meta App 運用向け）を保持
  - **既存デプロイは無停止で自動移行**: 初回アクセス時に env（IG_USER_ID 等）から
    default アカウントを lazy seed し、既存データの `account_id` を backfill。
    アカウントを追加しない限り挙動は従来と完全に同一
  - Webhook: `entry.id` で受信アカウントを確定（単一アカウント時は従来互換の
    フォールバック）。署名検証は env + 各アカウントの app_secret を順に試行
  - 既存 API 全てに optional `?account_id=`（省略時 default）— SDK / MCP /
    既存 admin は無改修で動作
  - 新 API `/api/accounts`（owner のみ）: 登録 / トークン更新 / 有効・無効
  - cron はアクティブアカウントをループし、per-account でトークンリフレッシュ
    （`ig_token_state` singleton は seed 元として残置、新規書き込み停止）+
    step 配信 / broadcast / followup drip を実行
  - Admin: サイドバーのアカウント切替（2件以上で表示）、設定ページに
    「Instagram アカウント」管理セクション
  - SDK: `InstagramHarnessConfig.accountId` で全リクエストをスコープ
  - MCP ツールのアカウント指定は次バージョン対応（default アカウントで動作）

### Known limitations (multi-account)
- `followers.igsid` / `tags.name` のグローバル UNIQUE 制約は維持。DM の IGSID は
  Meta 仕様でアカウントごとに異なるため実運用での衝突は稀だが、同一ユーザーが
  複数アカウントに接触した場合 follower 行は最初のアカウントに帰属する。
  タグ名前空間は全アカウント共有（同名タグは作成不可）。
  SQLite の制約変更はテーブル再構築（FK の ON DELETE CASCADE により危険）が
  必要なため、安全な手順を用意して次バージョンで対応予定

### Added (from unreleased)
- **IG account attribution on LINE cross-link**: tracked link URLs sent to
  LINE Harness now carry `iga` (IG business account user id, from
  `env.IG_USER_ID`) and `igan` (account @username, from `env.IG_USERNAME`,
  omitted when unset) alongside the existing `ig` (follower IGSID) param.
  LINE Harness stores them in `friends.metadata` so each LINE friend shows
  which Instagram account funneled them in. Worker-only change — no DB
  migration, no npm package release required.
  - `resolveLineCrossLinkUrl` accepts `options.account` (`IgAccountRef`);
    values are env-sourced today and swap to an accounts table when the
    single-worker multi-account refactor lands

## [0.5.3] - 2026-05-12

### Fixed
- **`@ig-harness/sdk` build failure on fresh installs**: `packages/sdk` was
  missing a `@types/node` devDependency, so `tsup --dts` failed during
  `pnpm -r build` with `TS2304: Cannot find name 'URLSearchParams'` in
  `src/resources/followers.ts`. Affected anyone running
  `npx create-ig-harness@0.5.2` from a clean workspace (notably on Windows
  where there was no pre-existing hoisted `@types/node`).
  - Added `@types/node@^22` to `packages/sdk/package.json`
  - `mcp-server` / `create-ig-harness` bumped to 0.5.3 to keep the unified
    version policy

## [0.5.2] - 2026-04-26

### Added
- **`allow_repeat` フラグ on `engagement_gates`**: When set to 1, every
  matching trigger creates a fresh delivery and the service skips the
  idempotent early-return — the same follower can run the CTA → reward
  flow repeatedly. Useful for demo / nurture campaigns.
  - Default `0` (legacy idempotent behavior preserved)
  - Migration `0013_gate_allow_repeat.sql` adds the column and drops
    the `uq_gate_deliveries_gate_follower` unique index so multiple rows
    per `(gate_id, follower_id)` are allowed at the DB level
  - `createGateDelivery` in `@ig-harness/db` accepts `allow_repeat` and
    branches: `1` → always insert, `0` → SELECT-then-INSERT (legacy)
  - `triggerGateForComment` / `triggerGateForDmKeyword` /
    `triggerGateForStoryMention` pass `gate.allow_repeat` through and
    skip the `delivery.status !== 'triggered'` early-return when 1
- API: POST/PATCH `/api/engagement-gates` accepts `allow_repeat: 0 | 1`

## [0.5.1] - 2026-04-26

### Added
- Persistent links to the **Setup Guide wiki**
  (<https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>) at
  five user-facing entry points so anyone running into a setup snag can jump
  straight to the screenshot-rich walkthrough:
  - `create-ig-harness setup` intro and outro panels
  - `README.md` top-level banner
  - `docs/QUICKSTART.md` and `docs/SETUP-GUIDE.md` headers
  - Admin sidebar footer (above the Logout button)

## [0.5.0] - 2026-04-26

### Added
- `GET /terms-of-service` endpoint on the worker. Returns a Meta-policy-aware
  Terms of Service page so the operator can paste it directly into the
  Meta App Dashboard alongside Privacy Policy and Data Deletion URLs.
- `create-ig-harness setup` now prints **Meta App publish URLs** at completion:
  Privacy Policy / Data Deletion / Terms of Service URLs are listed in a
  copy-paste friendly block, with a reminder about the 1024x1024 app icon
  and the "ビジネス" category.

### Changed
- All public npm packages bumped to **0.5.0** (uniform versioning):
  `@ig-harness/sdk`, `@ig-harness/mcp-server`, `create-ig-harness`.
- README / SETUP-GUIDE / QUICKSTART tone corrected: the comment-reply
  feature works under Standard Access via `postCommentToMedia` (top-level
  @mention). Only true thread-style replies require Advanced Access.

### Security
- `.ig-harness-deployed.json` (generated by `create-ig-harness setup`) is
  now ignored by `.gitignore`. It contains the deployed worker's owner
  API key and was at risk of being committed via `git add .`.

## [0.4.7] - 2026-04-26

### Added
- `InstagramClient.postCommentToMedia(mediaId, message)` — posts a top-level
  comment to one of the authenticated user's own media. This works under
  Standard Access (unlike `/{comment_id}/replies` which requires Advanced
  Access for external commenters' comments).

### Changed
- Engagement gate's "comment_reply_text" feature now uses
  `postCommentToMedia(mediaId, "@{{username}} ...")` instead of
  `replyToComment(commentId, ...)`. Trade-off: replies are visible as
  top-level @mention comments rather than threaded replies. Threaded
  replies still require Advanced Access (App Review).
- Webhook handler skips comments whose `from.id` matches `IG_USER_ID` so
  the gate's own auto-posted public reply doesn't recursively re-trigger
  itself with a "user not found" DM-send error.

## [0.4.6] - 2026-04-26

### Fixed
- `replyToComment` always failed with `Instagram API error 400: Object
  does not exist, cannot be loaded due to missing permissions, or does
  not support this operation` (code 100, subcode 33) because the SDK
  sent the message as a JSON body. The IG Graph API only accepts
  query-parameter encoded `message` for `/replies`. Switching to
  `POST /{comment_id}/replies?message=<urlencoded>` makes engagement
  gates' `comment_reply_text` (the public reply with @username) post
  correctly. DM dispatch was already working — only the public reply
  was silently broken.

## [0.4.5] - 2026-04-25

### Fixed
- `create-ig-harness` no longer uses hardcoded names for the Worker, D1
  database, and R2 bucket — the previous `ig-harness` / `ig-harness-images`
  literals collided with any prior deployment on the same Cloudflare
  account, so a returning user (or anyone running the scaffolder a
  second time on the same account) would silently overwrite their
  existing Worker bindings. Fix: scaffolder now generates a random
  8-char hex suffix once per setup and applies it to all three
  resources (`ig-harness-<suffix>`, `ig-harness-<suffix>-images`).
  The suffix is persisted to the state file so resumes stay consistent.

## [0.4.4] - 2026-04-25

### Fixed
- `create-ig-harness` Worker deploy step would intermittently send
  `account_id = "YOUR_ACCOUNT_ID"` to the Cloudflare API even though the
  scaffolder had already determined the real account id (failing with
  `Could not route to /accounts/YOUR_ACCOUNT_ID/...`). Root cause: the
  step backed up and overwrote the user-facing `wrangler.toml` in-place,
  which on some runs collided with wrangler's own config resolution.
  Now writes a deploy-only `wrangler.deploy.toml` and passes
  `--config wrangler.deploy.toml`, so the user's `wrangler.toml` is
  never touched and there is no restore-after-deploy race.

## [0.4.3] - 2026-04-25

### Fixed
- `create-ig-harness` scaffolder now runs `pnpm -r build` after install, so
  Worker deploy can resolve workspace packages like `@ig-harness/ig-sdk`.
  Previously the scaffolder went straight from install to `wrangler deploy`,
  which failed with "Could not resolve @ig-harness/ig-sdk" because the
  workspace `dist/` directories were empty. Affects every external user
  who had a fresh `~/.ig-harness/` clone.
- Re-running the scaffolder against an existing `~/.ig-harness/` checkout
  now also re-runs install + build (previously only `git pull` ran, leaving
  stale dependencies / dist).

## [0.4.2] - 2026-04-25

### Fixed
- `create-ig-harness` scaffolder cloned the wrong git URL
  (`Shudesu/ig-harness.git`, which is private) so `npx create-ig-harness`
  always failed with a clone error for external users. Repo URL now
  points at the public mirror `Shudesu/ig-harness-oss.git`.
  ([#1](https://github.com/Shudesu/ig-harness-oss/issues/1))

## [0.4.1] - 2026-04-25

### Fixed
- LINE connection registry now exposes an in-place `update` path so
  rotating an `api_key` or fixing a `worker_url` typo no longer requires
  delete-and-recreate (which orphaned every gate referencing the old id).
  Worker `PATCH /api/line-connections/:id`, SDK `lineConnections.update()`,
  MCP `manage_line_connections` action `update`.
- `manage_engagement_gates` `line_connection_id` description now points
  at the actually-registered MCP tool (`manage_line_connections`
  action='list') instead of a nonexistent `list_line_connections`.

## [0.4.0] - 2026-04-25

### Added
- LINE Harness cross-link automation: engagement gates can bind to a
  LINE Harness connection + traffic pool. Reward / CTA / reminder URLs
  are auto-rewritten through a LINE Harness tracked link at delivery
  time so the recipient's IGSID rides along `?ig=<IGSID>` on click,
  capturing the IG↔LINE userId pair on first friend-add
- `engagement_gates.line_connection_id` / `line_pool_slug` /
  `line_tracked_link_short` columns (migration `0012`); the short id
  is cached lazily on first delivery via a conditional UPDATE to
  serialize concurrent first-deliveries
- New MCP tool `manage_line_connections` with full CRUD +
  `set_default` + `test` + `list_tracked_links` + `list_traffic_pools`
- `manage_engagement_gates` MCP extended with `line_connection_id` /
  `line_pool_slug`
- SDK: new `lineConnections` resource, new `LineConnection` /
  `CreateLineConnectionInput` / `LineHarnessTrackedLink` /
  `LineHarnessPool` types, EngagementGate types extended with
  `line_*` fields
- Admin UI: campaign wizard surfaces a two-mode toggle on the reward
  URL — 「🔗 LINE Harness 連携」 (auto cross-link) vs 「🌐 URL 直接指定」
  (manual URL)
- Campaign detail page renders a 🔗 LINE連携 badge with the bound
  connection, pool, and cached tracked-link short
- `scripts/apply-migrations.mjs` so `pnpm db:migrate` actually applies
  every migration file (per-statement, idempotent on duplicate-column /
  already-exists errors)

### Fixed
- CI: leftover `@line-crm/*` workspace filter / `dist/line_harness/`
  paths in deploy workflows renamed to the IG Harness equivalents

## [0.3.2] - 2026-04-24

### Added
- Rich DM messages: reusable structured templates (text / image / card /
  carousel / quick_replies blocks) referenced per slot by engagement gates,
  expanded into sequential IG Messenger API calls at send time
- `rich_messages` table + 3 nullable `*_rich_message_id` columns on
  `engagement_gates` (legacy text path preserved as fallback)
- Worker endpoints: `/api/rich-messages` CRUD + `test-send`,
  `/api/posts/my-reels`, `/api/posts/bulk-apply-gates`
- MCP tools: `manage_rich_messages`, `list_recent_reels`,
  `bulk_apply_gates_to_reels`; `manage_engagement_gates` extended with
  `*_rich_message_id` fields
- SDK resources: `richMessages`, `posts`
- Admin UI: gate detail shows "リッチメッセージ" row when a slot references
  a rich message
- Vitest: 3 new tests for rich-CTA / rich-reward / legacy fallback paths

### Changed
- Gate create/update + bulk-apply enforce that rich CTA templates contain
  a `CHECK_FOLLOW:{GATE_ID}:{DELIVERY_ID}` postback — otherwise deliveries
  would stall in `cta_sent`
- `list_recent_reels` filters locally (max 100 media fetched) so feed
  posts can't crowd out reels in the returned slice
- `ig-sdk`: `getMyMedia`, `getMediaInfo` now include `media_product_type`

## [0.3.0] - 2026-04-08

### Added
- Engagement Gates with ManyChat-style follow check loop
- Cross-platform UUID linking with LINE Harness via shared-secret webhook
- Dashboard `/campaigns` for gate CRUD + analytics
- `@ig-harness/sdk` engagement-gates resource
- `@ig-harness/mcp-server` `manage_engagement_gates` tool
- Vitest test suite for worker services (17 tests)

### Removed
- Outgoing webhooks SDK/MCP/DB code (dead, no backing route)
- google-calendar service (unused)

## [0.2.0] - 2026-03-30

### Added
- Initial SDK, MCP server, and dashboard
- Comment → DM automation
- Step sequences, broadcasts, tracked links, forms
- Story mention handling
- `npx create-ig-harness` scaffolder
