import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleFollowCheckPostback } from '../engagement-gate.js';

function createMockDb() {
  const gates: any[] = [];
  const deliveries: any[] = [];
  const updates: any[] = [];

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first() {
        if (sql.includes('FROM engagement_gates')) {
          return gates.find((g) => g.id === params[0]) ?? null;
        }
        if (sql.includes('FROM gate_deliveries')) {
          return deliveries.find((d) => d.id === params[0]) ?? null;
        }
        return null;
      },
      async all() { return { results: [] }; },
      async run() {
        if (sql.startsWith('UPDATE gate_deliveries')) {
          updates.push({ sql, params });
          const id = params[params.length - 1];
          const target = deliveries.find((d) => d.id === id);
          if (target) {
            const match = sql.match(/SET (.+) WHERE/);
            if (match) {
              const fields = match[1].split(',').map((s) => s.trim().split(' = ')[0]);
              fields.forEach((f, i) => { (target as any)[f] = params[i]; });
            }
          }
        }
        return { meta: { changes: 1 } };
      },
    };
  }

  return {
    gates, deliveries, updates,
    prepare(sql: string) {
      const stmt = makeStatement(sql, []);
      return {
        ...stmt,
        bind(...params: unknown[]) {
          return makeStatement(sql, params);
        },
      };
    },
  } as unknown as D1Database & { gates: any[]; deliveries: any[]; updates: any[] };
}

const baseGate = {
  id: 'gate-1', status: 'active', trigger_type: 'comment_on_post',
  target_post_id: 'post-1', trigger_keyword: null, require_follow: 1,
  initial_dm_text: 'CTA', initial_dm_button_label: '受け取る',
  follow_reminder_dm_text: 'まずはフォローしてね', follow_reminder_button_label: 'フォローしたよ',
  reward_dm_text: '🎁ありがとう！', reward_url: 'https://example.com/r/abc',
  max_loops: 0,
};

const baseDelivery = {
  id: 'delivery-1', gate_id: 'gate-1', follower_id: 42, igsid: 'IGSID42',
  status: 'cta_sent', loop_count: 0, last_check_at: null,
  triggered_at: '2026-04-08T00:00:00Z', delivered_at: null, metadata: '{}',
};

describe('handleFollowCheckPostback', () => {
  let igClient: any;
  beforeEach(() => {
    igClient = {
      sendText: vi.fn(async () => ({})),
      sendGenericTemplate: vi.fn(async () => ({})),
      getUserProfile: vi.fn(),
    };
  });

  it('delivers reward when user is following', async () => {
    const db = createMockDb();
    db.gates.push({ ...baseGate });
    db.deliveries.push({ ...baseDelivery });
    igClient.getUserProfile.mockResolvedValue({ is_user_follow_business: true });

    await handleFollowCheckPostback(db, igClient, {
      gateId: 'gate-1', deliveryId: 'delivery-1', igsid: 'IGSID42',
    });

    expect(igClient.sendText).toHaveBeenCalledTimes(1);
    expect(igClient.sendText.mock.calls[0][1]).toContain('🎁ありがとう！');
    expect(igClient.sendText.mock.calls[0][1]).toContain('https://example.com/r/abc');
    expect(db.deliveries[0].status).toBe('delivered');
    expect(db.deliveries[0].delivered_at).toBeTruthy();
  });

  it('sends reminder + increments loop_count when not following', async () => {
    const db = createMockDb();
    db.gates.push({ ...baseGate });
    db.deliveries.push({ ...baseDelivery });
    igClient.getUserProfile.mockResolvedValue({ is_user_follow_business: false });

    await handleFollowCheckPostback(db, igClient, {
      gateId: 'gate-1', deliveryId: 'delivery-1', igsid: 'IGSID42',
    });

    expect(igClient.sendText).not.toHaveBeenCalled();
    expect(igClient.sendGenericTemplate).toHaveBeenCalledTimes(1);
    const [, elements] = igClient.sendGenericTemplate.mock.calls[0];
    expect(JSON.stringify(elements)).toContain('まずはフォローしてね');
    expect(JSON.stringify(elements)).toContain('CHECK_FOLLOW:gate-1:delivery-1');
    expect(db.deliveries[0].status).toBe('pending_follow');
    expect(db.deliveries[0].loop_count).toBe(1);
  });

  it('loops indefinitely when max_loops = 0 and user keeps not following', async () => {
    const db = createMockDb();
    db.gates.push({ ...baseGate, max_loops: 0 });
    db.deliveries.push({ ...baseDelivery, loop_count: 5, status: 'pending_follow' });
    igClient.getUserProfile.mockResolvedValue({ is_user_follow_business: false });

    await handleFollowCheckPostback(db, igClient, {
      gateId: 'gate-1', deliveryId: 'delivery-1', igsid: 'IGSID42',
    });

    expect(db.deliveries[0].loop_count).toBe(6);
    expect(db.deliveries[0].status).toBe('pending_follow');
    expect(igClient.sendGenericTemplate).toHaveBeenCalled();
  });

  it('does nothing when delivery is already delivered', async () => {
    const db = createMockDb();
    db.gates.push({ ...baseGate });
    db.deliveries.push({ ...baseDelivery, status: 'delivered' });

    await handleFollowCheckPostback(db, igClient, {
      gateId: 'gate-1', deliveryId: 'delivery-1', igsid: 'IGSID42',
    });

    expect(igClient.getUserProfile).not.toHaveBeenCalled();
    expect(igClient.sendText).not.toHaveBeenCalled();
  });

  it('does nothing when gate or delivery missing', async () => {
    const db = createMockDb();

    await handleFollowCheckPostback(db, igClient, {
      gateId: 'gate-1', deliveryId: 'delivery-1', igsid: 'IGSID42',
    });

    expect(igClient.getUserProfile).not.toHaveBeenCalled();
  });
});
