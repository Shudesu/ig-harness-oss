# Changelog

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
