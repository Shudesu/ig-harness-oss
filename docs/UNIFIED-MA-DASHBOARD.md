# Unified MA Dashboard Direction

IG Harness should stay useful as a standalone OSS product, but the product
direction is a unified marketing automation dashboard that can operate IG,
LINE, and X from one place.

## Target shape

```text
Unified Dashboard / Operator
  -> Connector registry
      -> LINE Harness Worker API
      -> IG Harness Worker API
      -> X Harness Worker API
  -> Shared identity graph
      -> platform_user_links
      -> tracked links / forms / verification callbacks
  -> Campaign orchestration
      -> audience, trigger, eligibility, delivery, analytics
```

Each Harness owns platform-specific auth, webhook handling, API limits, and
delivery primitives. The unified dashboard owns campaign composition and gives
operators one UX for cross-platform journeys.

## Connector contract

Every Harness should expose a small common surface:

- `GET /api/health`
- `GET /api/staff/me`
- `GET /api/capabilities`
- `GET /api/connectors`
- `POST /api/connectors/test`
- `POST /api/tracked-links`
- `GET /api/tracked-links/:id/clicks`
- `POST /api/identity/link`
- `POST /api/identity/resolve`

Platform-specific APIs can remain as-is. The common connector APIs let a future
dashboard discover what a deployment can do without hardcoding product-specific
assumptions.

## Identity model

Use a stable internal `person_id` and attach platform identities to it:

```text
person_id
  line_friend_id
  ig_igsid / ig_scoped_user_id
  x_user_id / x_username
  email / phone / external_id
```

Tracked links and LIFF/forms should carry signed attribution params. A click or
form submission should upsert an identity link, then notify the originating
Harness through a webhook.

## CLI direction

The `create-*` CLIs should converge on the same operational behavior:

- `--help` and `--version` must never clone, authenticate, or deploy.
- `setup` may clone the product repo, create resources, and write resumable
  setup state.
- `update` should not clone by default. It should read deployed state and call
  Cloudflare APIs directly.
- Deployed state should be small, explicit, and portable:
  worker name/url, admin project/url, D1 name/id, R2 bucket, account id.
- Secrets should not remain in resumable setup state after success.
- Wrangler calls should pin the selected Cloudflare account and retry auth
  refresh in TTY mode when needed.

## Near-term IG work

1. Harden `create-ig-harness update` so it does not unexpectedly clone/pull.
2. Add `GET /api/capabilities` to IG as the first connector-discovery endpoint.
3. Add a first-class LINE connection setup step to IG, matching the existing
   `line_harness_connections` worker API.
4. Add `/api/capabilities` to LINE and X so a dashboard can discover features.
5. Move X's ad-hoc LINE form creation into a reusable connector contract.
6. Start a separate `ma-dashboard` app only after the connector contract is
   stable enough to avoid a brittle three-product mega-refactor.
