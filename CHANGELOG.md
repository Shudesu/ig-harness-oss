# Changelog

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
