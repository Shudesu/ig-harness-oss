import { describe, it, expect, beforeEach, vi } from 'vitest';
import { triggerGateForComment, handleFollowCheckPostback } from '../engagement-gate.js';

// In-memory D1 mock with rich_messages support
function createMockDb() {
  const gates: any[] = [];
  const richMessages: any[] = [];
  const deliveries: any[] = [];

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first<T>() {
        if (sql.includes('FROM engagement_gates') && sql.includes('WHERE id = ?')) {
          return gates.find((g) => g.id === params[0]) ?? null;
        }
        if (sql.includes('FROM rich_messages') && sql.includes('WHERE id = ?')) {
          return richMessages.find((r) => r.id === params[0]) ?? null;
        }
        if (sql.includes('FROM gate_deliveries') && sql.includes('WHERE id = ?')) {
          return deliveries.find((d) => d.id === params[0]) ?? null;
        }
        if (sql.includes('FROM gate_deliveries') && sql.includes('WHERE gate_id = ? AND follower_id = ?')) {
          return deliveries.find((d) => d.gate_id === params[0] && d.follower_id === params[1]) ?? null;
        }
        return null;
      },
      async all<T>() {
        if (sql.includes('FROM engagement_gates') && sql.includes("status = 'active'")) {
          return { results: gates.filter((g) => g.status === 'active') };
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

  return {
    gates, richMessages, deliveries,
    prepare(sql: string) {
      const stmt = makeStatement(sql, []);
      return { ...stmt, bind(...params: unknown[]) { return makeStatement(sql, params); } };
    },
  } as any;
}

const ig = {
  sendGenericTemplate: vi.fn(async () => ({})),
  sendQuickReply: vi.fn(async () => ({})),
  sendText: vi.fn(async () => ({})),
  sendImage: vi.fn(async () => ({})),
  sendRichMessage: vi.fn(async () => ({ sentBlocks: 1 })),
  getUserProfile: vi.fn(async () => ({ is_user_follow_business: true })),
};

describe('engagement gate with rich messages', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends rich CTA when initial_dm_rich_message_id is set', async () => {
    const db = createMockDb();
    db.richMessages.push({
      id: 'rm-cta',
      name: 'cta v1',
      kind: 'cta',
      blocks: JSON.stringify([{ type: 'text', text: 'hello' }]),
    });
    db.gates.push({
      id: 'gate-1',
      status: 'active',
      trigger_type: 'comment_on_post',
      target_post_id: 'post-1',
      trigger_keyword: null,
      require_follow: 1,
      initial_dm_text: '',
      initial_dm_button_label: 'x',
      follow_reminder_dm_text: '',
      follow_reminder_button_label: '',
      reward_dm_text: '',
      reward_url: null,
      max_loops: 0,
      initial_dm_rich_message_id: 'rm-cta',
      reward_dm_rich_message_id: null,
      follow_reminder_dm_rich_message_id: null,
    });

    await triggerGateForComment(db, ig as never, {
      postId: 'post-1',
      commentText: 'any text',
      follower: { id: 42, igsid: 'IGSID42' },
    });

    expect(ig.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(ig.sendGenericTemplate).not.toHaveBeenCalled();
    const call = ig.sendRichMessage.mock.calls[0] as unknown as [string, unknown[], { gateId: string }];
    expect(call[0]).toBe('IGSID42');
    expect(call[2].gateId).toBe('gate-1');
  });

  it('falls back to legacy text path when rich message reference is missing', async () => {
    const db = createMockDb();
    db.gates.push({
      id: 'gate-2',
      status: 'active',
      trigger_type: 'comment_on_post',
      target_post_id: 'post-1',
      trigger_keyword: null,
      require_follow: 1,
      initial_dm_text: 'legacy cta',
      initial_dm_button_label: '押す',
      follow_reminder_dm_text: '',
      follow_reminder_button_label: '',
      reward_dm_text: '',
      reward_url: null,
      max_loops: 0,
      initial_dm_rich_message_id: 'rm-missing',
      reward_dm_rich_message_id: null,
      follow_reminder_dm_rich_message_id: null,
    });

    await triggerGateForComment(db, ig as never, {
      postId: 'post-1',
      commentText: 'any',
      follower: { id: 1, igsid: 'IG1' },
    });

    expect(ig.sendRichMessage).not.toHaveBeenCalled();
    expect(ig.sendGenericTemplate).toHaveBeenCalledTimes(1);
  });

  it('delivers rich reward when reward_dm_rich_message_id is set and follow verified', async () => {
    const db = createMockDb();
    db.richMessages.push({
      id: 'rm-reward',
      name: 'reward v1',
      kind: 'reward',
      blocks: JSON.stringify([
        { type: 'text', text: 'thanks' },
        { type: 'card', title: 'Get it', buttons: [{ type: 'url', label: 'Go', url: '{REWARD_URL}' }] },
      ]),
    });
    db.gates.push({
      id: 'gate-3',
      status: 'active',
      trigger_type: 'comment_on_post',
      target_post_id: 'post-1',
      trigger_keyword: null,
      require_follow: 1,
      initial_dm_text: '',
      initial_dm_button_label: 'x',
      follow_reminder_dm_text: '',
      follow_reminder_button_label: '',
      reward_dm_text: 'legacy reward',
      reward_url: 'https://line.example.com/add',
      max_loops: 0,
      initial_dm_rich_message_id: null,
      reward_dm_rich_message_id: 'rm-reward',
      follow_reminder_dm_rich_message_id: null,
    });
    db.deliveries.push({
      id: 'd-1',
      gate_id: 'gate-3',
      follower_id: 42,
      igsid: 'IGSID42',
      status: 'cta_sent',
      loop_count: 0,
      last_check_at: null,
      delivered_at: null,
      triggered_at: new Date().toISOString(),
      metadata: '{}',
    });

    await handleFollowCheckPostback(db, ig as never, {
      gateId: 'gate-3',
      deliveryId: 'd-1',
      igsid: 'IGSID42',
    });

    expect(ig.sendRichMessage).toHaveBeenCalledTimes(1);
    expect(ig.sendText).not.toHaveBeenCalled();
    const call = ig.sendRichMessage.mock.calls[0] as unknown as [string, unknown[], { rewardUrl: string }];
    expect(call[2].rewardUrl).toBe('https://line.example.com/add');
  });
});
