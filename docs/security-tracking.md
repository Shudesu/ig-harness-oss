# Signed tracking links and credential storage

New deployments and upgrades redirect old links normally. By default only verified,
unexpired tokens can identify a click or trigger tags/scenarios. No new configuration
is required for an existing installation with its existing `API_KEY` or `IG_APP_SECRET`.
Warnings never print key values.

## Local tracking

- `/t/:linkId?t=...`: HMAC-SHA256, `base64url(JSON).base64url(MAC)` (no padding).
  Claims: `v:1`, `purpose:"link"`, `linkId`, exactly one of `igsid` / `followerId`,
  `exp` (Unix seconds, seven days), `n` (16 random bytes, base64url).
- `/click/:gateId?u=...&t=...`: same envelope with `purpose:"gate"`, gate ID in
  `linkId`, `igsid`, and a SHA-256 digest (base64url) of the exact decoded destination in `destination`.
  The signature is checked with Web Crypto HMAC verification. The destination must
  still match a configured origin. Changing destination, resource or purpose invalidates attribution.
- `TRACKING_SIGNING_SECRET` is an optional dedicated UTF-8 secret. Without it, derive
  32 bytes with HKDF-SHA256 from `API_KEY` (otherwise `IG_APP_SECRET`), empty salt,
  UTF-8 info `ig-tracking-token-v1`. With no source key, issue anonymous links.
- `TRACKING_ALLOW_UNSIGNED_ACTIONS=true` temporarily enables legacy `ig` / `lu` / `f`
  attribution on `/t` only, still within the link's account. Default: disabled.
  An invalid/empty `t` never falls back to unsigned identity, even with this flag.
  **Keep this flag disabled**: enabling it deliberately restores the impersonation risk.
- Old, invalid and expired links still redirect and count as anonymous clicks.
  `/click` never trusts legacy identity and strips raw `ig` / `lu` / `f` / `iga`
  parameters from its destination; unsigned wrappers also lose downstream `igt`.
- The Instagram client final message boundary personalizes same-origin `/t` URLs in
  text, templates, rich messages, DMs, broadcasts and scenarios using the actual
  recipient. Private replies to comment IDs (no known IGSID) remain anonymous.
  Static API/admin tracking URLs remain anonymous until used in a message.
  Configure the existing `WORKER_URL` to match those URLs' origin; alternate-domain
  URLs and manually written external links are not rewritten.
- Click responses use `no-store` and `no-referrer`. Gate analytics store destination
  origin/path only, avoiding persistence of bearer query tokens and referrers.

These are transferable bearer tokens, not proof of the clicking browser's identity.
They are signed, not encrypted: payloads are base64url-decodable. Repeat valid clicks
retain existing tag/scenario behavior; these tokens are not single-use login tokens.
Rotating/replacing a local signing key invalidates attribution for outstanding links
but preserves their redirects. Links older than seven days are anonymous.

## LINE Harness interoperability (spec 08)

Outbound LINE URLs carry `igt` only, never a raw `ig` fallback. Payload:
`{v:1,igsid,iga?,exp,n}`; seven-day expiry and 16-byte nonce; same HMAC envelope.
Use `IG_LINK_TOKEN_SECRET` as UTF-8 key, or derive 32 bytes with HKDF-SHA256 from
existing `LINE_HARNESS_LINK_SECRET`, empty salt, UTF-8 info `ig-link-token-v1`.
The LINE-side name for this fallback source in spec 08 is `IG_HARNESS_LINK_SECRET`:
both sides must hold the same shared value. This key is separate from local tracking.
Without either shared key, links are anonymous and a warning is logged.

Deploy spec 08 support on the LINE receiver before expecting identity linking.
It must verify `igt`, preserve it through redirects/LIFF/OAuth, reject expired or
invalid signatures, and implement nonce reuse restrictions for friend linking.
An older LINE Harness can still redirect, but will not identify recipients from `igt`.
This repository does not implement or change that external receiver or its policies.
The same shared signing setup must be available on every connected LINE deployment.

## Credentials and connection URLs

New `line_harness_connections.api_key`, legacy integration config API keys, and
account `app_secret` writes use existing AES-GCM `enc:v1:` storage. AAD:

- `line-api-key:<connection-id>`
- `legacy-line-api-key`
- `ig-app-secret:<ig-user-id>`

Use existing `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64). When absent, derive an
AES key from `API_KEY` (otherwise `IG_APP_SECRET`) with HKDF-SHA256, empty salt,
info `ig-credential-storage-v1`, and warn. Never fall back to plaintext writes.
Plaintext rows remain readable. Unknown `enc:` versions and failed authentication
are rejected. API results retain masking/has-secret indicators; no full secret is returned.
Webhook signatures, deletion signatures, token validation/refresh and appsecret proof
all decrypt the per-account app secret at use time.

Scheduled maintenance encrypts up to 20 plaintext accounts and 20 connections per
run, plus the legacy integration config. Updates compare the previous value so they
do not overwrite concurrent rotations. Columns and original rows are preserved.
Readers try the dedicated key and then the fallback, so adding a dedicated key does
not make fallback-encrypted rows unreadable. It does **not** re-encrypt those rows:
retain the original fallback source until those credentials have been re-saved with
the dedicated key. Rotating/removing any encryption source without re-encryption can
make its rows unreadable. Back up keys securely; do not print them in migration logs.

Connection URLs are validated on save and immediately before credentialed fetches:
HTTPS only, no embedded credentials/query/fragment, no localhost/local/internal host,
private/link-local/metadata IPv4, mapped/abbreviated IPv4 tricks or IPv6 literal.
All IPv6 literals are conservatively refused. Fetches use `redirect:"error"` so a
remote redirect cannot forward credentials to another destination. Old HTTP rows are
retained but sends fail until the owner updates the URL. This is static URL validation;
it does not pin DNS or resolve arbitrary public hostnames to detect DNS rebinding.
Only register trusted, operator-controlled public LINE Harness hosts.

## D1 rate limits and rollout

Apply additive migration `0023_rate_limit_buckets.sql` using the repository's normal
migration runner before deployment when possible. Counters use one atomic UPSERT per
bucket with hashed keys, a fixed window and existing ceilings. Scheduled maintenance
removes expired counters. Without the migration/binding or during D1 failure, a warning
is logged and the prior isolate limiter remains active. Limits are distributed only
while D1 counters are available; the fixed window can permit boundary bursts.
The nonexistent incoming-webhook receive route was removed from the public allowlist.

Recommended rollout: back up encryption keys, prepare LINE spec 08 verification and
shared key agreement, apply migration, deploy this worker, inspect warnings and confirm
signed clicks/linking. Leave unsigned actions disabled. Deployment, remote migration,
secret provisioning and live-message verification are owner operations, not performed
by the local hardening change.
