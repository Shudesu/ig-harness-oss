/**
 * Tests: GET /click/:gateId open-redirect prevention (FIX-2)
 *
 * (a) destination origin matches gate's reward_url → 302
 * (b) destination is a foreign origin → 400
 * (c) unknown gate → 400
 * (d) destination origin matches connection's worker_url → 302 (LINE bridge)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Encode a URL to base64url (same as production)
function encodeBase64Url(url: string): string {
  const b64 = btoa(encodeURIComponent(url).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16)),
  ));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGates: Map<string, { id: string; reward_url: string | null; line_connection_id: string | null }> = new Map();
const mockConnections: Map<string, { id: string; worker_url: string }> = new Map();

vi.mock('@ig-harness/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ig-harness/db')>();
  return {
    ...original,
    getEngagementGate: vi.fn().mockImplementation(async (_db: D1Database, id: string) => {
      return mockGates.get(id) ?? null;
    }),
  };
});

// ---------------------------------------------------------------------------
// Build app with just the engagement-gates route
// ---------------------------------------------------------------------------
async function buildApp() {
  const { Hono } = await import('hono');
  const { engagementGates } = await import('../engagement-gates.js');

  const app = new Hono<{
    Bindings: {
      DB: D1Database;
      API_KEY: string;
      IG_APP_SECRET: string;
      IG_VERIFY_TOKEN: string;
      WORKER_URL: string;
    };
  }>();
  app.route('/', engagementGates);

  // Minimal DB stub — queries for line_harness_connections
  const dbStub = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => {
          // Support the line_connection lookup in the click handler
          if (sql.includes('line_harness_connections') && params[0]) {
            return mockConnections.get(params[0] as string) ?? null;
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 0 } }),
    }),
  } as unknown as D1Database;

  const executionCtxStub = {
    waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
    passThroughOnException: () => {},
  } as ExecutionContext;

  async function makeRequest(path: string) {
    const req = new Request(`http://localhost${path}`);
    return app.fetch(req, {
      DB: dbStub,
      API_KEY: 'test-key',
      IG_APP_SECRET: 'secret',
      IG_VERIFY_TOKEN: 'verify',
      WORKER_URL: 'https://worker.test',
    }, executionCtxStub);
  }

  return { makeRequest };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /click/:gateId origin validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGates.clear();
    mockConnections.clear();
  });

  it('(a) 302 when destination origin matches gate reward_url', async () => {
    mockGates.set('gate-1', {
      id: 'gate-1',
      reward_url: 'https://line.me/R/ti/p/@example',
      line_connection_id: null,
    });

    const destination = 'https://line.me/auth?ref=ig';
    const { makeRequest } = await buildApp();
    const res = await makeRequest(`/click/gate-1?u=${encodeBase64Url(destination)}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(destination);
  });

  it('(b) 400 when destination is a foreign origin (open-redirect blocked)', async () => {
    mockGates.set('gate-2', {
      id: 'gate-2',
      reward_url: 'https://line.me/R/ti/p/@example',
      line_connection_id: null,
    });

    const { makeRequest } = await buildApp();
    const res = await makeRequest(`/click/gate-2?u=${encodeBase64Url('https://evil.example/steal')}`);

    expect(res.status).toBe(400);
  });

  it('(c) 400 when gate does not exist', async () => {
    // No gate registered for 'gate-unknown'
    const { makeRequest } = await buildApp();
    const res = await makeRequest(`/click/gate-unknown?u=${encodeBase64Url('https://line.me/path')}`);

    expect(res.status).toBe(400);
  });

  it('(d) 302 when destination origin matches line connection worker_url', async () => {
    mockGates.set('gate-3', {
      id: 'gate-3',
      reward_url: 'https://line.me/R/ti/p/@example',
      line_connection_id: 'conn-1',
    });
    mockConnections.set('conn-1', {
      id: 'conn-1',
      worker_url: 'https://korega-saigo.workers.dev',
    });

    const destination = 'https://korega-saigo.workers.dev/auth/line?ref=ig';
    const { makeRequest } = await buildApp();
    const res = await makeRequest(`/click/gate-3?u=${encodeBase64Url(destination)}&ig=IGSID42`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(destination);
  });

  it('(e) 400 when destination is foreign even if gate has a line connection', async () => {
    mockGates.set('gate-4', {
      id: 'gate-4',
      reward_url: 'https://line.me/R/ti/p/@example',
      line_connection_id: 'conn-1',
    });
    mockConnections.set('conn-1', {
      id: 'conn-1',
      worker_url: 'https://korega-saigo.workers.dev',
    });

    const { makeRequest } = await buildApp();
    const res = await makeRequest(`/click/gate-4?u=${encodeBase64Url('https://attacker.io/steal')}`);

    expect(res.status).toBe(400);
  });
});
