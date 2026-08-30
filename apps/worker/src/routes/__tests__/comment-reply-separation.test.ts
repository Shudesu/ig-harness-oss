import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ig-harness/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ig-harness/db')>();
  return {
    ...original,
    upsertFriend: vi.fn().mockResolvedValue({ id: 7, igsid: 'commenter-1' }),
    getScenarios: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../services/engagement-gate.js', () => ({
  triggerGateForComment: vi.fn().mockResolvedValue(false),
  triggerGateForDmKeyword: vi.fn().mockResolvedValue(false),
  triggerGateForStoryMention: vi.fn().mockResolvedValue(false),
  handleFollowCheckPostback: vi.fn().mockResolvedValue(undefined),
  processFollowupDrip: vi.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
}));

import { handleCommentEvent } from '../webhook.js';

function createDb(rule: Record<string, unknown>, logged: unknown[][] = []): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          logged.push([sql, ...args]);
          return this;
        },
        all: async () => ({ results: sql.includes('FROM comment_rules') ? [rule] : [] }),
        first: async () => null,
        run: async () => ({ meta: {} }),
      };
    },
  } as unknown as D1Database;
}

function createIgClient() {
  return {
    getUserProfile: vi.fn().mockResolvedValue({}),
    replyToComment: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
  };
}

const comment = {
  id: 'comment-1',
  text: 'PRICE please',
  from: { id: 'commenter-1', username: 'alice' },
  media: { id: 'media-1' },
  created_time: '2026-08-30T00:00:00Z',
};

describe('comment rule public reply / DM separation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses reply_text publicly and response_body only for the DM', async () => {
    const rule = {
      id: 'rule-1',
      keyword: 'price',
      match_type: 'contains',
      media_id: null,
      response_type: 'text',
      response_body: JSON.stringify({ text: 'Private offer for {{username}}' }),
      reply_text: '@{{username}} public acknowledgement',
      delay_seconds: 0,
    };
    const logged: unknown[][] = [];
    const igClient = createIgClient();

    await handleCommentEvent(
      createDb(rule, logged),
      igClient as never,
      comment,
      'business-account',
      undefined,
      undefined,
      'account-a',
    );

    expect(igClient.replyToComment).toHaveBeenCalledWith(
      'comment-1',
      '@alice public acknowledgement',
    );
    expect(igClient.sendText).toHaveBeenCalledWith('commenter-1', 'Private offer for alice');
    expect(logged.some((call) => call.includes(JSON.stringify({ text: 'Private offer for alice' })))).toBe(true);
  });

  it('sends DM only when the optional public reply is blank', async () => {
    const rule = {
      id: 'rule-2',
      keyword: '',
      match_type: 'any_comment',
      media_id: null,
      response_type: 'text',
      response_body: JSON.stringify({ text: 'Private only' }),
      reply_text: '',
      delay_seconds: 0,
    };
    const igClient = createIgClient();

    await handleCommentEvent(
      createDb(rule),
      igClient as never,
      { ...comment, id: 'comment-2', text: 'hello' },
      'business-account',
      undefined,
      undefined,
      'account-a',
    );

    expect(igClient.replyToComment).not.toHaveBeenCalled();
    expect(igClient.sendText).toHaveBeenCalledWith('commenter-1', 'Private only');
  });

  it('keeps the legacy default public reply for existing NULL rows', async () => {
    const rule = {
      id: 'rule-3',
      keyword: '',
      match_type: 'any_comment',
      media_id: null,
      response_type: 'text',
      response_body: JSON.stringify({ text: 'Private legacy DM' }),
      reply_text: null,
      delay_seconds: 0,
    };
    const igClient = createIgClient();

    await handleCommentEvent(
      createDb(rule),
      igClient as never,
      { ...comment, id: 'comment-3', text: 'hello' },
      'business-account',
      undefined,
      undefined,
      'account-a',
    );

    expect(igClient.replyToComment).toHaveBeenCalledWith(
      'comment-3',
      expect.stringContaining('@alice'),
    );
    expect(igClient.sendText).toHaveBeenCalledWith('commenter-1', 'Private legacy DM');
  });
});
