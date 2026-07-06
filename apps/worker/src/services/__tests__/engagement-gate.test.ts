import { describe, it, expect, beforeEach, vi } from 'vitest';
import { triggerGateForComment } from '../engagement-gate.js';

// Module-level mock so logMessage doesn't hit the real DB
vi.mock('@ig-harness/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ig-harness/db')>();
  return {
    ...original,
    logMessage: vi.fn().mockResolvedValue(undefined),
  };
});

// Minimal in-memory D1 mock — only the methods we use
function createMockDb() {
  const gates: any[] = [];
  const deliveries: any[] = [];
  const followers: any[] = [];
  const log: string[] = [];

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first<T>() {
        if (sql.includes('FROM engagement_gates') && sql.includes('WHERE id = ?')) {
          return gates.find((g) => g.id === params[0]) ?? null;
        }
        if (sql.includes('FROM gate_deliveries') && sql.includes('WHERE gate_id = ? AND follower_id = ?')) {
          return deliveries.find((d) => d.gate_id === params[0] && d.follower_id === params[1]) ?? null;
        }
        return null;
      },
      async all<T>() {
        if (sql.includes("FROM engagement_gates") && sql.includes("status = 'active'")) {
          return { results: gates.filter((g) => g.status === 'active') };
        }
        if (sql.includes("FROM engagement_gates")) {
          return { results: gates };
        }
        return { results: [] };
      },
      async run() {
        if (sql.startsWith('INSERT INTO gate_deliveries')) {
          deliveries.push({
            id: params[0], gate_id: params[1], follower_id: params[2],
            igsid: params[3], metadata: params[4],
            status: 'triggered', loop_count: 0,
            last_check_at: null, delivered_at: null,
            triggered_at: new Date().toISOString(),
          });
        }
        if (sql.startsWith('UPDATE gate_deliveries')) {
          // Naive: last param is id
          const id = params[params.length - 1];
          const target = deliveries.find((d) => d.id === id);
          if (target) {
            const m = sql.match(/SET (.+) WHERE/);
            if (m) {
              const fields = m[1].split(',').map((s) => s.trim().split(' = ')[0]);
              fields.forEach((f, i) => { (target as any)[f] = params[i]; });
            }
          }
        }
        return { meta: { changes: 1 } };
      },
    };
  }

  const db = {
    gates, deliveries, followers, log,
    prepare(sql: string) {
      const stmt = makeStatement(sql, []);
      return {
        ...stmt,
        bind(...params: unknown[]) {
          return makeStatement(sql, params);
        },
      };
    },
  };
  return db as unknown as D1Database & { gates: any[]; deliveries: any[]; followers: any[]; log: string[] };
}

const fakeIgClient = {
  sendGenericTemplate: vi.fn(async () => ({})),
  sendQuickReply: vi.fn(async () => ({})),
  sendText: vi.fn(async () => ({})),
  getUserProfile: vi.fn(async () => ({ is_user_follow_business: true })),
};

describe('triggerGateForComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a delivery and sends CTA DM when gate matches', async () => {
    const db = createMockDb();
    db.gates.push({
      id: 'gate-1',
      status: 'active',
      trigger_type: 'comment_on_post',
      target_post_id: 'post-1',
      trigger_keyword: '参加',
      require_follow: 1,
      initial_dm_text: '特典の準備ができました！下のボタンを押してね',
      initial_dm_button_label: '特典を受け取る',
      follow_reminder_dm_text: '',
      follow_reminder_button_label: '',
      reward_dm_text: '',
      reward_url: null,
      max_loops: 0,
    });

    await triggerGateForComment(db, fakeIgClient as never, {
      postId: 'post-1',
      commentText: '参加します',
      follower: { id: 42, igsid: 'IGSID42' },
    });

    expect(db.deliveries).toHaveLength(1);
    expect(db.deliveries[0].gate_id).toBe('gate-1');
    expect(db.deliveries[0].follower_id).toBe(42);
    expect(fakeIgClient.sendGenericTemplate).toHaveBeenCalledTimes(1);
    const call = fakeIgClient.sendGenericTemplate.mock.calls[0] as unknown as [string, unknown[]];
    expect(call[0]).toBe('IGSID42');
    expect(JSON.stringify(call[1])).toContain('CHECK_FOLLOW:gate-1:');
  });

  it('does nothing when no active gate matches the post', async () => {
    const db = createMockDb();
    db.gates.push({
      id: 'gate-1', status: 'active', trigger_type: 'comment_on_post',
      target_post_id: 'post-OTHER', trigger_keyword: null,
      require_follow: 1, initial_dm_text: 'x', initial_dm_button_label: 'x',
      follow_reminder_dm_text: '', follow_reminder_button_label: '',
      reward_dm_text: '', reward_url: null, max_loops: 0,
    });

    await triggerGateForComment(db, fakeIgClient as never, {
      postId: 'post-1',
      commentText: '参加します',
      follower: { id: 42, igsid: 'IGSID42' },
    });

    expect(db.deliveries).toHaveLength(0);
    expect(fakeIgClient.sendGenericTemplate).not.toHaveBeenCalled();
  });

  it('skips when keyword does not match', async () => {
    const db = createMockDb();
    db.gates.push({
      id: 'gate-1', status: 'active', trigger_type: 'comment_on_post',
      target_post_id: 'post-1', trigger_keyword: '参加',
      require_follow: 1, initial_dm_text: 'x', initial_dm_button_label: 'x',
      follow_reminder_dm_text: '', follow_reminder_button_label: '',
      reward_dm_text: '', reward_url: null, max_loops: 0,
    });

    await triggerGateForComment(db, fakeIgClient as never, {
      postId: 'post-1',
      commentText: '無関係なコメント',
      follower: { id: 42, igsid: 'IGSID42' },
    });

    expect(db.deliveries).toHaveLength(0);
  });
});

describe('logMessage integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls logMessage with direction:out and triggerSource:gate after triggerGateForComment', async () => {
    const { logMessage } = await import('@ig-harness/db');

    // Extended mock DB that handles SELECT by id after INSERT
    // so createGateDelivery's post-insert SELECT succeeds.
    const gates: any[] = [];
    const deliveries: any[] = [];

    function makeStatement(sql: string, params: unknown[]) {
      return {
        async first<T>() {
          if (sql.includes('FROM engagement_gates') && sql.includes('WHERE id = ?')) {
            return (gates.find((g) => g.id === params[0]) ?? null) as T;
          }
          if (sql.includes('FROM gate_deliveries') && sql.includes('WHERE gate_id = ?') && sql.includes('follower_id = ?')) {
            return (deliveries.find((d) => d.gate_id === params[0] && d.follower_id === params[1]) ?? null) as T;
          }
          // Post-insert SELECT by id
          if (sql.includes('FROM gate_deliveries') && sql.includes('WHERE id = ?')) {
            return (deliveries.find((d) => d.id === params[0]) ?? null) as T;
          }
          return null as T;
        },
        async all<T>() {
          if (sql.includes("FROM engagement_gates") && sql.includes("status = 'active'")) {
            return { results: gates.filter((g) => g.status === 'active') as T[] };
          }
          if (sql.includes("FROM engagement_gates")) {
            return { results: gates as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.startsWith('INSERT INTO gate_deliveries')) {
            deliveries.push({
              id: params[0], gate_id: params[1], follower_id: params[2],
              igsid: params[3], metadata: params[4],
              status: 'triggered', loop_count: 0,
              last_check_at: null, delivered_at: null,
              triggered_at: new Date().toISOString(),
              followup_step_sent: 0, next_followup_at: null,
            });
          }
          if (sql.startsWith('UPDATE gate_deliveries')) {
            const id = params[params.length - 1];
            const target = deliveries.find((d) => d.id === id);
            if (target) {
              const m = sql.match(/SET (.+) WHERE/);
              if (m) {
                const fields = m[1].split(',').map((s) => s.trim().split(' = ')[0]);
                fields.forEach((f, i) => { (target as any)[f] = params[i]; });
              }
            }
          }
          return { meta: { changes: 1 } };
        },
      };
    }

    const db = {
      gates, deliveries,
      prepare(sql: string) {
        const stmt = makeStatement(sql, []);
        return { ...stmt, bind(...p: unknown[]) { return makeStatement(sql, p); } };
      },
    } as unknown as D1Database;

    gates.push({
      id: 'gate-log',
      status: 'active',
      trigger_type: 'comment_on_post',
      target_post_id: 'post-log',
      target_post_ids: [],
      trigger_keyword: null,
      require_follow: 1,
      initial_dm_text: 'CTA text',
      initial_dm_button_label: 'Tap me',
      follow_reminder_dm_text: '',
      follow_reminder_button_label: '',
      reward_dm_text: '',
      reward_url: null,
      max_loops: 0,
      allow_repeat: 0,
      created_at: '2025-01-01T00:00:00Z',
    });

    const igClient = {
      sendGenericTemplate: vi.fn(async () => ({})),
      sendQuickReply: vi.fn(async () => ({})),
      sendText: vi.fn(async () => ({})),
      getUserProfile: vi.fn(async () => ({ is_user_follow_business: true })),
    };

    await triggerGateForComment(db, igClient as never, {
      postId: 'post-log',
      commentText: 'anything',
      follower: { id: 99, igsid: 'IGSID99' },
    });

    expect(logMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        direction: 'out',
        triggerSource: 'gate',
        messageType: 'template',
        followerId: 99,
      }),
    );
  });
});
