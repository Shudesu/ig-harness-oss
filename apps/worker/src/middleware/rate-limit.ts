import { ADMIN_SESSION_COOKIE, readCookie } from '../lib/admin-session.js';
import { sha256 } from '../lib/security.js';
/** D1 fixed-window limiter, with legacy in-memory fallback before migration. */

import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

// ---------------------------------------------------------------------------
// Core rate-limit logic
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const PRUNE_INTERVAL = 60_000;
let lastPrune = Date.now();

function prune(windowMs: number): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL) return;
  lastPrune = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

function check(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  prune(windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= max) {
    const oldest = entry.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { ok: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
  }

  entry.timestamps.push(now);
  return { ok: true, remaining: max - entry.timestamps.length, retryAfter: 0 };
}

let warnedFallback = false;
export async function checkShared(db: D1Database | undefined, key: string, max: number, windowMs: number): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
  const now = Date.now();
  try {
    if (!db) throw new Error('D1 binding unavailable');
    const row = await db.prepare(`INSERT INTO rate_limit_buckets(bucket_key,hits,expires_at) VALUES(?,1,?)
      ON CONFLICT(bucket_key) DO UPDATE SET
        hits=CASE WHEN expires_at<=? THEN 1 ELSE MIN(hits+1,?) END,
        expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
      RETURNING hits,expires_at`)
      .bind(await sha256(key), now + windowMs, now, max + 1, now)
      .first<{ hits: number; expires_at: number }>();
    if (!row) throw new Error('Rate limit counter unavailable');
    return { ok: row.hits <= max, remaining: Math.max(0, max - row.hits), retryAfter: row.hits > max ? Math.max(1, Math.ceil((row.expires_at - now) / 1000)) : 0 };
  } catch {
    if (!warnedFallback) { console.warn('[rate-limit] D1 counter unavailable; using isolate fallback (apply migrations)'); warnedFallback = true; }
    return check(key, max, windowMs);
  }
}

// ---------------------------------------------------------------------------
// Paths that are unauthenticated (lower limit, keyed by IP)
// ---------------------------------------------------------------------------

const UNAUTHENTICATED_PATTERNS: Array<string | RegExp> = [
  '/webhook',
  /^\/api\/forms\/[^/]+\/submit$/,
];

function isUnauthenticatedPath(path: string): boolean {
  return UNAUTHENTICATED_PATTERNS.some((p) =>
    typeof p === 'string' ? path === p : p.test(path),
  );
}

function getClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0'
  );
}

// ---------------------------------------------------------------------------
// Hono middleware
// ---------------------------------------------------------------------------

const AUTHENTICATED_MAX = 1000;
const AUTHENTICATED_WINDOW = 60_000; // 1 min

const UNAUTHENTICATED_MAX = 100;
const UNAUTHENTICATED_WINDOW = 60_000; // 1 min

export async function rateLimitMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;

  // Skip rate limiting for docs / static assets
  if (path === '/docs' || path === '/openapi.json' || path.startsWith('/r/')) {
    return next();
  }

  const ip = getClientIp(c);
  const ceiling = await checkShared(c.env?.DB, `ceiling:${ip}`, 3000, 60_000);
  if (!ceiling.ok) return c.json({ success: false, error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(ceiling.retryAfter) } });
  if (path === '/api/auth/login' && c.req.method === 'POST') {
    const login = await checkShared(c.env?.DB, `login:${ip}`, 10, 60_000);
    if (!login.ok) return c.json({ success: false, error: 'Too many login attempts' }, { status: 429, headers: { 'Retry-After': String(login.retryAfter) } });
  }
  let key: string;
  let max: number;
  let windowMs: number;

  if (isUnauthenticatedPath(path)) {
    // Key by IP for unauthenticated endpoints
    key = `ip:${getClientIp(c)}`;
    max = UNAUTHENTICATED_MAX;
    windowMs = UNAUTHENTICATED_WINDOW;
  } else {
    // Key by API key for authenticated endpoints
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : readCookie(c, ADMIN_SESSION_COOKIE);
    if (token) {
      // Hash the complete credential so shared prefixes cannot share/bypass buckets.
      key = `key:${await sha256(token)}`;
      max = AUTHENTICATED_MAX;
      windowMs = AUTHENTICATED_WINDOW;
    } else {
      // No auth header — key by IP with the lower limit
      key = `ip:${getClientIp(c)}`;
      max = UNAUTHENTICATED_MAX;
      windowMs = UNAUTHENTICATED_WINDOW;
    }
  }

  const result = await checkShared(c.env?.DB, key, max, windowMs);

  if (!result.ok) {
    return c.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }

  // Proceed and attach rate-limit headers to the response
  await next();

  c.header('X-RateLimit-Remaining', String(result.remaining));
}

export function resetRateLimitsForTests(): void { store.clear(); warnedFallback = false; lastPrune = Date.now(); }
