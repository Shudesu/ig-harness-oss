# Contributing to Instagram Harness

Thanks for your interest in contributing! This document covers local setup, testing, and PR guidelines.

## Development Setup

```bash
pnpm install
pnpm dev:worker            # Start worker on :8787
cd apps/web && pnpm dev    # Start dashboard on :3000
```

You will need a Cloudflare account and a Meta developer app in **Dev Mode** with a test Instagram account added as a tester. See [`docs/SETUP-GUIDE.md`](docs/SETUP-GUIDE.md) for full details.

## Project Structure

```
apps/worker/                     - Cloudflare Workers API (Hono)
apps/web/                        - Next.js 15 admin dashboard
packages/db/                     - D1 schema & queries
packages/ig-sdk/                 - Instagram Graph API client
packages/sdk/                    - TypeScript client SDK (@ig-harness/sdk)
packages/mcp-server/             - MCP Server for Claude Code
packages/shared/                 - Shared types
packages/create-ig-harness/ - `npx create-ig-harness` scaffolder
```

## Testing

```bash
pnpm test                                    # Run all tests
pnpm --filter @ig-harness/worker test # Worker unit tests (Vitest)
pnpm --filter @ig-harness/sdk test    # SDK tests
pnpm typecheck                               # TypeScript strict check
pnpm build                                   # Build all packages
```

All new features must include Vitest unit tests for worker services. Dashboard changes should be manually smoke-tested against a local worker.

## Pull Requests

1. Fork the repo
2. Create a feature branch (`feat/my-feature` or `fix/bug-description`)
3. Make your changes, keep commits focused and descriptive
4. Run `pnpm build`, `pnpm typecheck`, and `pnpm test` — all must pass
5. Update `CHANGELOG.md` under the `[Unreleased]` section if you add/change user-facing behavior
6. Submit a PR with a clear description of **what** and **why**

## Code Style

- TypeScript strict mode — no `any` without justification
- Hono for worker routes, snake_case in DB/API, camelCase in SDK/frontend (convert via serialize helpers)
- Prefer small, single-responsibility modules over large files
- No secrets in code, config, or commits — use `wrangler secret put` / env vars

## Reporting Issues

Please include:

- Instagram Harness version (`package.json`)
- Worker logs (`wrangler tail`)
- Steps to reproduce
- Expected vs actual behavior
