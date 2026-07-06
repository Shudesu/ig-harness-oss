/**
 * Tests: processFollowupDrip step-advance guarded by send success (FIX-5)
 *
 * When the IG send fails (throws), the step counter must NOT advance so the
 * next cron tick retries the same step. The delivery must NOT be counted as sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFollowupDrip } from '../engagement-gate.js';

// Mock DB helpers from @ig-harness/db
vi.mock('@ig-harness/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ig-harness/db')>();
  return {
    ...original,
    logMessage: vi.fn().mockResolvedValue(undefined),
    getRichMessage: vi.fn().mockResolvedValue(null),
    parseFollowupSequence: vi.fn().mockImplementation(
      (seq: string | null) => {
        if (!seq) return [];
        try { return JSON.parse(seq); } catch { return []; }
      },
    ),
  };
});

// Mock line-cross-link so it doesn't make real network calls
vi.mock('../line-cross-link.js', () => ({
  resolveLineCrossLinkUrl: vi.fn().mockResolvedValue(null),
}));

// Mock health lib
vi.mock('../../lib/health.js', () => ({
  recordDmFailure: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// DB stub factory
// ---------------------------------------------------------------------------
function makeDb(deliveries: any[], gates: any[]) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        all: async <T>() => {
          // Simulate due followups query
          if (sql.includes('gate_deliveries') && sql.includes('next_followup_at')) {
            return { results: deliveries as T[] };
          }
          return { results: [] as T[] };
        },
        first: async <T>() => {
          // getEngagementGate lookup
          if (sql.includes('FROM engagement_gates') && sql.includes('WHERE id = ?')) {
            return (gates.find((g) => g.id === params[0]) ?? null) as T;
          }
          // gate_target_posts
          if (sql.includes('gate_target_posts')) {
            return null as T;
          }
          return null as T;
        },
        run: async () => ({ meta: { changes: 1 } }),
      }),
      all: async <T>() => ({ results: [] as T[] }),
      first: async <T>() => null as T,
      run: async () => ({ meta: { changes: 1 } }),
    }),
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('processFollowupDrip — step-advance guard on send failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT advance step when send throws — delivery is retried next tick', async () => {
    const followupSequence = JSON.stringify([
      { text: 'Step 1 message', delay_minutes: 60 },
      { text: 'Step 2 message', delay_minutes: 120 },
    ]);

    const gates = [{
      id: 'gate-a',
      status: 'active',
      followup_dm_sequence: followupSequence,
      reward_url: 'https://line.me/example',
      line_connection_id: null,
    }];

    const now = new Date();
    const pastTime = new Date(now.getTime() - 60_000).toISOString().slice(0, 19) + 'Z';

    const deliveries = [{
      id: 'del-1',
      gate_id: 'gate-a',
      igsid: 'IGSID_TEST',
      follower_id: 1,
      followup_step_sent: 0,
      next_followup_at: pastTime,
      delivered_at: new Date(now.getTime() - 60_000).toISOString(),
      status: 'delivered',
    }];

    // Track updateGateDelivery calls
    const updateCalls: any[] = [];
    const db = makeDb(deliveries, gates);
    // Override the run for UPDATE statements to capture calls
    const origPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (sql.startsWith('UPDATE gate_deliveries')) {
        return {
          ...stmt,
          bind: (...params: unknown[]) => ({
            ...stmt.bind(...params),
            run: async () => {
              updateCalls.push({ sql, params });
              return { meta: { changes: 1 } };
            },
          }),
        };
      }
      return stmt;
    };

    const igClient = {
      // send always throws — simulates a transient IG API error
      sendText: vi.fn().mockRejectedValue(new Error('IG API 503')),
      sendImage: vi.fn().mockRejectedValue(new Error('IG API 503')),
      sendGenericTemplate: vi.fn().mockRejectedValue(new Error('IG API 503')),
      sendQuickReply: vi.fn().mockRejectedValue(new Error('IG API 503')),
    };

    const result = await processFollowupDrip(db, igClient as never, undefined, 50);

    // On failure: sent=0, skipped=1 (not silently ignored)
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);

    // The step counter must NOT have advanced — no UPDATE was issued
    // that would advance followup_step_sent.
    const stepAdvanceCalls = updateCalls.filter(
      (c) => JSON.stringify(c.params).includes('followup_step_sent'),
    );
    expect(stepAdvanceCalls).toHaveLength(0);
  });

  it('advances step and counts as sent when send succeeds', async () => {
    const followupSequence = JSON.stringify([
      { text: 'Step 1 message', delay_minutes: 60 },
      { text: 'Step 2 message', delay_minutes: 120 },
    ]);

    const gates = [{
      id: 'gate-b',
      status: 'active',
      followup_dm_sequence: followupSequence,
      reward_url: 'https://line.me/example',
      line_connection_id: null,
    }];

    const now = new Date();
    const pastTime = new Date(now.getTime() - 60_000).toISOString().slice(0, 19) + 'Z';

    const deliveries = [{
      id: 'del-2',
      gate_id: 'gate-b',
      igsid: 'IGSID_OK',
      follower_id: 2,
      followup_step_sent: 0,
      next_followup_at: pastTime,
      delivered_at: new Date(now.getTime() - 60_000).toISOString(),
      status: 'delivered',
    }];

    const db = makeDb(deliveries, gates);

    const igClient = {
      sendText: vi.fn().mockResolvedValue({}),
      sendImage: vi.fn().mockResolvedValue({}),
      sendGenericTemplate: vi.fn().mockResolvedValue({}),
      sendQuickReply: vi.fn().mockResolvedValue({}),
    };

    const result = await processFollowupDrip(db, igClient as never, undefined, 50);

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
  });
});
