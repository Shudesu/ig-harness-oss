import { issueIgLinkToken } from '../lib/tracking-token.js';
import { openCredential, type CredentialEnv } from '../lib/credential-crypto.js';
import { validateWorkerUrl } from '../lib/worker-url.js';
import type { EngagementGate } from '@ig-harness/db';

/**
 * Narrow fetch interface for testability. The Workers `fetch` global is typed
 * as `(URL | RequestInfo, RequestInit) => Promise<Response>`, which makes it
 * awkward to inject a `vi.fn()` mock from tests. We accept the minimum shape
 * the service actually uses.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Identifies which IG business account generated the link. Today the values
 * come from env (single-account deploy); a future multi-account refactor
 * swaps the supplier to an accounts table without touching this service.
 */
export interface IgAccountRef {
  id?: string;
  username?: string;
  security?: CredentialEnv;
}

/**
 * Rewrite an outbound reward/CTA URL through a LINE Harness tracked link so
 * the recipient's IG↔LINE userId pair is captured on first click.
 *
 * Strategy:
 *   - One tracked link per engagement_gate, cached on `line_tracked_link_short`.
 *     Creating one link per recipient would work but bloats LINE Harness's DB
 *     for no added insight — identity is carried in a per-recipient signed `igt` token.
 *   - Lazy: we only POST to LINE Harness on the first delivery that actually
 *     needs it. Gates that never deliver don't waste an API call.
 *   - Failure-tolerant: if LINE Harness is unreachable / returns non-2xx, we
 *     return null so the caller can fall back to the raw reward_url rather
 *     than stalling delivery.
 *
 * The returned URL is `<worker>/r/<short>?igt=<signed-token>[&pool=<slug>]`.
 * LINE Harness must implement spec 08 verification before linking identities.
 * Without a shared signing key the URL remains usable but anonymous.
 */
export async function resolveLineCrossLinkUrl(
  db: D1Database,
  gate: EngagementGate,
  igsid: string,
  options: { fetchImpl?: FetchFn; account?: IgAccountRef; env?: CredentialEnv } = {},
): Promise<string | null> {
  if (!gate.line_connection_id) return null;
  if (!gate.reward_url) return null;

  const conn = await db
    .prepare('SELECT id, worker_url, api_key FROM line_harness_connections WHERE id = ?')
    .bind(gate.line_connection_id)
    .first<{ id: string; worker_url: string; api_key: string }>();
  if (!conn) return null;

  const workerUrl = validateWorkerUrl(conn.worker_url);
  const env = options.env ?? options.account?.security ?? {};
  const apiKey = await openCredential(conn.api_key, `line-api-key:${conn.id}`, env);
  const fetchImpl: FetchFn = options.fetchImpl ?? ((u, init) => fetch(u, init));

  let short = gate.line_tracked_link_short;
  if (!short) {
    try {
      const res = await fetchImpl(`${workerUrl}/api/tracked-links`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          name: trackedLinkName(gate),
          originalUrl: gate.reward_url,
        }),
      });
      if (!res.ok) {
        console.error(
          `[line-cross-link] create failed: ${res.status} for gate=${gate.id}`,
        );
        return null;
      }
      const json = (await res.json()) as {
        success?: boolean;
        data?: { id?: string };
      };
      if (!json.success || !json.data?.id) {
        console.error('[line-cross-link] create returned invalid payload');
        return null;
      }
      short = json.data.id;

      // Cache it on the gate so future deliveries skip this roundtrip.
      // Conditional UPDATE: only persist when the column is still NULL so
      // two concurrent first deliveries can't overwrite each other's id.
      // If meta.changes === 0 we lost the race — re-read the winner and
      // use that short so every recipient in this burst shares one tracked
      // link (our extra create is a harmless orphan on LINE Harness side).
      try {
        const res = await db
          .prepare(
            'UPDATE engagement_gates SET line_tracked_link_short = ? WHERE id = ? AND line_tracked_link_short IS NULL',
          )
          .bind(short, gate.id)
          .run();
        const changes = (res as { meta?: { changes?: number } }).meta?.changes ?? 0;
        if (changes === 0) {
          const fresh = await db
            .prepare('SELECT line_tracked_link_short FROM engagement_gates WHERE id = ?')
            .bind(gate.id)
            .first<{ line_tracked_link_short: string | null }>();
          if (fresh?.line_tracked_link_short) {
            short = fresh.line_tracked_link_short;
          }
        }
        gate.line_tracked_link_short = short;
      } catch (err) {
        console.error('[line-cross-link] cache write failed:', err);
      }
    } catch (err) {
      console.error('[line-cross-link] network error:', err);
      return null;
    }
  }

  const params = new URLSearchParams();
  const token = await issueIgLinkToken(env, igsid, options.account?.id);
  if (token) params.set('igt', token);
  const accountUsername = options.account?.username?.replace(/^@/, '');
  if (accountUsername) params.set('igan', accountUsername);
  if (gate.line_pool_slug) params.set('pool', gate.line_pool_slug);
  return `${workerUrl}/r/${encodeURIComponent(short)}${params.size ? '?' + params.toString() : ''}`;
}

/**
 * Build the human-readable label shown on LINE Harness's tracked-link list so
 * the LINE operator can attribute clicks back to the IG campaign. Truncated
 * to stay under typical label column widths.
 */
function trackedLinkName(gate: EngagementGate): string {
  const shortId = gate.id.slice(0, 8);
  return `ig-harness ${shortId} — ${gate.name}`.slice(0, 120);
}
