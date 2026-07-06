/**
 * Tests: role-guard on GET /api/accounts (FIX-C)
 *
 * Verifies that:
 * (a) GET /api/accounts with no staff in context → 403
 * (b) GET /api/accounts with staff role=staff → 403
 * (c) GET /api/accounts with staff role=admin → 200
 * (d) GET /api/accounts with staff role=owner → 200
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../index.js';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic imports
// ---------------------------------------------------------------------------

vi.mock('@ig-harness/db', () => ({
  listIgAccounts: vi.fn().mockResolvedValue([]),
  ensureDefaultAccount: vi.fn().mockResolvedValue(undefined),
  getIgAccountById: vi.fn(),
  getIgAccountByIgUserId: vi.fn(),
  createIgAccount: vi.fn(),
  updateIgAccount: vi.fn(),
}));

vi.mock('../../lib/accounts.js', () => ({
  ensureDefaultAccount: vi.fn().mockResolvedValue(undefined),
  resolveAccount: vi.fn(),
}));

import { accounts } from '../accounts.js';

// ---------------------------------------------------------------------------
// Helper: build an app that pre-populates c.get('staff') before handing off
// ---------------------------------------------------------------------------

type StaffRole = 'owner' | 'admin' | 'staff';

function buildApp(staffRole: StaffRole | null) {
  const app = new Hono<Env>();

  // Inject staff into context (simulates authMiddleware)
  app.use('*', async (c, next) => {
    if (staffRole !== null) {
      c.set('staff', { id: 'test-staff', name: 'Test User', role: staffRole });
    }
    return next();
  });

  app.route('/', accounts);
  return app;
}

function makeEnv() {
  return {
    DB: {} as D1Database,
    IG_APP_SECRET: 'secret',
    IG_ACCESS_TOKEN: 'tok',
    IG_USER_ID: 'ig-A',
    IG_VERIFY_TOKEN: 'vt',
    API_KEY: 'key',
    WORKER_URL: 'https://test.workers.dev',
  };
}

const executionCtx = {
  waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
  passThroughOnException: () => {},
} as ExecutionContext;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/accounts role-guard (FIX-C)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('(a) no staff in context → 403', async () => {
    const app = buildApp(null);
    const res = await app.fetch(
      new Request('https://worker.example.com/api/accounts'),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(403);
  });

  it('(b) staff role=staff → 403', async () => {
    const app = buildApp('staff');
    const res = await app.fetch(
      new Request('https://worker.example.com/api/accounts'),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(403);
  });

  it('(c) staff role=admin → 200', async () => {
    const app = buildApp('admin');
    const res = await app.fetch(
      new Request('https://worker.example.com/api/accounts'),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(200);
  });

  it('(d) staff role=owner → 200', async () => {
    const app = buildApp('owner');
    const res = await app.fetch(
      new Request('https://worker.example.com/api/accounts'),
      makeEnv(),
      executionCtx,
    );
    expect(res.status).toBe(200);
  });
});
