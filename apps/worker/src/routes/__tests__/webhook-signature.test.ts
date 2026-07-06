/**
 * Tests: POST /webhook signature enforcement (FIX-1)
 *
 * These tests verify that:
 * (a) a valid HMAC-SHA256 signature → 200 (processes the event)
 * (b) an invalid signature → 403
 * (c) a missing X-Hub-Signature-256 header → 403
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

// Mock @ig-harness/db so we don't need a real D1 database
vi.mock('@ig-harness/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ig-harness/db')>();
  return {
    ...original,
    listIgAccounts: vi.fn().mockResolvedValue([]),
    upsertFriend: vi.fn().mockResolvedValue({ id: 1, igsid: 'test' }),
    getScenarios: vi.fn().mockResolvedValue([]),
    logMessage: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock the engagement-gate service so we don't pull in heavy D1 logic
vi.mock('../../services/engagement-gate.js', () => ({
  triggerGateForDmKeyword: vi.fn().mockResolvedValue(false),
  triggerGateForComment: vi.fn().mockResolvedValue(false),
  triggerGateForStoryMention: vi.fn().mockResolvedValue(false),
  handleFollowCheckPostback: vi.fn().mockResolvedValue(undefined),
  processFollowupDrip: vi.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
}));

// Mock accounts lib
vi.mock('../../lib/accounts.js', () => ({
  ensureDefaultAccount: vi.fn().mockResolvedValue(undefined),
  pickAccountForEntry: vi.fn().mockReturnValue(null),
  toIgAccountRef: vi.fn().mockReturnValue({}),
  getAccountClient: vi.fn().mockResolvedValue({}),
}));

// Mock health lib
vi.mock('../../lib/health.js', () => ({
  recordWebhookReceived: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helper: compute a real HMAC-SHA256 signature (same algorithm as production)
// ---------------------------------------------------------------------------
async function computeSignature(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Build a minimal Hono app with just the webhook route (same env shape)
// ---------------------------------------------------------------------------
async function buildApp(secret: string) {
  const { Hono } = await import('hono');
  const { webhook } = await import('../webhook.js');

  const app = new Hono<{
    Bindings: {
      DB: D1Database;
      IG_APP_SECRET: string;
      IG_VERIFY_TOKEN: string;
      WORKER_URL: string;
    };
  }>();
  app.route('/', webhook);

  // Create minimal DB stub
  const dbStub = {
    prepare: () => ({
      bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: {} }),
    }),
  } as unknown as D1Database;

  const executionCtxStub = {
    waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
    passThroughOnException: () => {},
  } as ExecutionContext;

  async function makeRequest(path: string, options: RequestInit & { env?: Record<string, unknown> } = {}) {
    const { env: _env, ...init } = options;
    const req = new Request(`http://localhost${path}`, init);
    return app.fetch(req, {
      DB: dbStub,
      IG_APP_SECRET: secret,
      IG_VERIFY_TOKEN: 'verify-token',
      WORKER_URL: 'https://test.workers.dev',
    }, executionCtxStub);
  }

  return { makeRequest };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const SECRET = 'test-secret-xyz';
const BODY = JSON.stringify({
  object: 'instagram',
  entry: [],
});

describe('POST /webhook signature enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) returns 200 for a valid HMAC-SHA256 signature', async () => {
    const { makeRequest } = await buildApp(SECRET);
    const sig = await computeSignature(BODY, SECRET);

    const res = await makeRequest('/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sig,
      },
      body: BODY,
    });

    expect(res.status).toBe(200);
  });

  it('(b) returns 403 for an invalid/wrong signature', async () => {
    const { makeRequest } = await buildApp(SECRET);

    const res = await makeRequest('/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=' + 'a'.repeat(64),
      },
      body: BODY,
    });

    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/invalid signature/i);
  });

  it('(c) returns 403 when X-Hub-Signature-256 header is missing', async () => {
    const { makeRequest } = await buildApp(SECRET);

    const res = await makeRequest('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: BODY,
    });

    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/invalid signature/i);
  });

  it('(d) returns 403 when signature header is an empty string', async () => {
    const { makeRequest } = await buildApp(SECRET);

    const res = await makeRequest('/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': '',
      },
      body: BODY,
    });

    expect(res.status).toBe(403);
  });
});
