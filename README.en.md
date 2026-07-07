🌐 [日本語](README.md) | **English** | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# IG Harness

> ### **[View the live demo](https://shudesu.github.io/ig-harness-oss/)** 👈

A fully open-source Instagram DM automation and marketing platform — a **free alternative to Vendor A and Vendor B**.
Runs entirely on Cloudflare's free tier. Server cost: **$0**. Fully operable from Claude Code.

### ▶️ [Watch on YouTube](https://youtu.be/xzEanXQtlO0)

[![Click to play on YouTube — Complete IG Harness Setup Walkthrough](https://img.youtube.com/vi/xzEanXQtlO0/maxresdefault.jpg)](https://youtu.be/xzEanXQtlO0)

> 📖 **Setup Guide (full walkthrough with screenshots)**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

**Current version**: v0.11.1 · MIT License · TypeScript / Cloudflare Workers + D1 + R2

---

## Why IG Harness?

| | Vendor A | Vendor B | **IG Harness** |
|---|---|---|---|
| Monthly cost | $15+ | ¥10,000–30,000/mo | **$0** |
| Comment → DM automation | ✅ | ✅ | ✅ |
| Follow gate (gated rewards) | ✅ | ✅ | ✅ |
| Drip / step sequences | ✅ | ✅ | ✅ |
| Rich messages (cards / buttons) | ✅ | ✅ | ✅ |
| Forms | ✅ | ✅ | ✅ |
| Tracking links | Partial | ✅ | ✅ |
| Open API | ❌ | ❌ | **Full access** |
| Claude Code (AI) integration | ❌ | ❌ | **MCP server included** |
| LINE account cross-linking | ❌ | ❌ | **UUID cross-link** |
| Multi-account support | Separate plan | Separate plan | **Built-in** |
| Meta review required | No | No | **No (works on Standard Access)** |
| Source code | Proprietary | Proprietary | **MIT (this repo)** |

---

## Quick Start

### Full setup in one command

```bash
npx create-ig-harness
```

The CLI handles everything:
- Cloudflare account authentication (wrangler login)
- D1 database + R2 bucket creation, schema migration
- Worker and admin dashboard deployment
- Instagram Pro account credentials registration
- Meta App Webhook integration guide (Privacy Policy / Data Deletion / Terms URLs auto-displayed)
- Owner user creation for first admin login

Setup time: ~5 minutes. Once complete, your admin dashboard (`https://<your-name>-admin.pages.dev`) is ready to use immediately.

### Requirements

- Cloudflare account (free tier is fine)
- Instagram Pro account (Business or Creator) + Meta App
- Node.js 22+ / pnpm

---

## Features

### Engagement (your primary growth engine)
- **Engagement gate** — Vendor A-style "Comment → DM → Follow check → Reward delivery" loop. If the user hasn't followed, sends a "follow us and come back" DM; after follow confirmation, the reward DM is sent automatically.
- **Comment → DM automation** — Trigger a DM reward delivery based on comments on specific posts or Reels (all posts or individually targeted).
- **Auto comment reply** — Keyword-based automated comment replies (posted as top-level comments with @mention; works on Standard Access).
- **Story mention → DM** — Automatically send a DM when your account is mentioned in a Story.
- **DM keyword trigger** — Fire a gate when a specific keyword is received in a DM.

### Broadcasting
- **Step sequences** — Keyword-triggered sequences that deliver timed DM follow-ups.
- **Follow-up drip** — Up to 3 additional DMs sent at minute-level intervals after initial reward delivery.
- **Broadcast** — Bulk DM to all followers or a filtered tag segment, with scheduling support.
- **Rich messages** — Cards with buttons, carousels, and quick replies.

### CRM
- **Follower management** — Auto-registration via Webhook, profile retrieval, custom metadata, and tags.
- **Operator chat** — Reply 1:1 directly from the admin dashboard. Automated DMs and button interactions are rendered in the conversation log.
- **Profile image caching** — Permanently caches Instagram CDN images to R2 to avoid signed-URL expiry.
- **Forms** — Collect data in-DM; responses are automatically saved as metadata.
- **Tracking links** — Click tracking and traffic source attribution.

### LINE Harness Integration
- **UUID cross-platform linking** — Bidirectionally links IG followers and LINE friends under a shared UUID via a shared-secret webhook. Sending a unique 1:1 URL automatically records "this IG user = this LINE friend" in both databases.
- **IG account source tracking** — In multi-account setups, records which IG account a user came from when registering on LINE.

### Multi-account
- Manage **multiple Instagram accounts** from a single Worker and dashboard.
- **Account-scoped data** — Followers, gates, and broadcasts are isolated per account.
- **Webhook routing** — Automatically identifies the receiving account from `entry.id`; supports multiple Meta Apps with multi-secret signature verification.

### Operational Monitoring
- **`GET /api/health`** — Per-account token expiry, live API health checks (checkpoint / freeze detection), last Webhook received, DM delivery failure count, and cron liveness.
- Combine with external probes to alert on anomalies (token expiry, delivery failure spikes, unresponsiveness).

### AI Integration
- **Bundled MCP Server** (`@ig-harness/mcp-server`) — Control everything from Claude Code in natural language.
- **Official SDK** (`@ig-harness/sdk`) — Typed TypeScript SDK, ESM + CJS.

### iOS App Support
- **`GET /api/capabilities`** — Compatibility endpoint for the iOS app (the-harness-ios).

---

## Architecture

```
[ Instagram Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ] + [ R2 ]
                                   ⇅
                         [ Cloudflare Pages (Next.js 15) ]
                                   ⇅
                         [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + Webhook handler + image serving; cron (every 5 min) for delivery processing, token refresh, and health probes.
- **Web** (`apps/web`): Next.js 15 dashboard.
- **Packages**:
  - `@ig-harness/sdk` — TypeScript SDK
  - `@ig-harness/mcp-server` — MCP server for Claude Code
  - `create-ig-harness` — Setup CLI
  - `@ig-harness/ig-sdk` — Thin wrapper around the Instagram Graph API
  - `@ig-harness/db` — D1 migrations + helpers
  - `@ig-harness/shared` — Shared type definitions

---

## A Note on Standard Access

The Instagram Messaging API works on **Standard Access (no Meta App Review required)** for Pro accounts you own and manage — including DM delivery, engagement gates, and comment replies.

**Advanced Access (App Review required) is only needed for**:
- True threaded replies nested directly under a parent comment
- Multi-tenant setups hosting accounts you do not own or manage (e.g., your clients' accounts)

IG Harness implements comment replies as top-level posts with an `@mention`, which works entirely within Standard Access.

---

## Documentation

- [Setup guide (video — YouTube)](https://youtu.be/xzEanXQtlO0)
- [Setup guide (with screenshots)](https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide)
- [npm: @ig-harness/sdk](https://www.npmjs.com/package/@ig-harness/sdk)
- [npm: @ig-harness/mcp-server](https://www.npmjs.com/package/@ig-harness/mcp-server)
- [npm: create-ig-harness](https://www.npmjs.com/package/create-ig-harness)

---

## License

MIT License. Free to use commercially, modify, and redistribute.

---

## Contributing

Issues and PRs are welcome. Please open PRs against `Shudesu/ig-harness-oss` (this repo).

---

> **IG Harness** by [@Shudesu](https://github.com/Shudesu) — Open-source Instagram DM automation for the AI-native era
