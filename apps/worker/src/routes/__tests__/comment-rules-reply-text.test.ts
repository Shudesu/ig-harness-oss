import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/accounts.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ id: 'account-a' }),
}));

import { commentRules } from '../comment-rules.js';

describe('comment rule replyText API contract', () => {
  it('persists and returns the public reply separately from the DM body', async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const row = {
      id: 'rule-1',
      name: 'Offer',
      trigger_type: 'comment',
      media_id: null,
      keyword: 'price',
      match_type: 'contains',
      response_type: 'text',
      response_body: JSON.stringify({ text: 'Private offer' }),
      reply_text: '@{{username}} check your DM',
      delay_seconds: 0,
      is_active: 1,
      created_at: '2026-08-30T00:00:00Z',
      updated_at: '2026-08-30T00:00:00Z',
    };
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            return this;
          },
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => row,
        };
      },
    } as unknown as D1Database;

    const response = await commentRules.fetch(
      new Request('https://worker.example/api/comment-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Offer',
          keyword: 'price',
          matchType: 'contains',
          responseType: 'text',
          responseBody: { text: 'Private offer' },
          replyText: '@{{username}} check your DM',
        }),
      }),
      { DB: db },
    );
    const body = await response.json<{ data: { responseBody: unknown; replyText: string } }>();

    expect(response.status).toBe(201);
    expect(body.data.responseBody).toEqual({ text: 'Private offer' });
    expect(body.data.replyText).toBe('@{{username}} check your DM');
    const insert = calls.find((call) => call.sql.includes('INSERT INTO comment_rules'));
    expect(insert?.sql).toContain('reply_text');
    expect(insert?.args).toContain('@{{username}} check your DM');
  });

  it('preserves an explicitly blank reply so the rule can be DM-only', async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            return this;
          },
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => ({
            id: 'rule-2', name: 'DM only', trigger_type: 'comment', media_id: null,
            keyword: null, match_type: 'any_comment', response_type: 'text',
            response_body: JSON.stringify({ text: 'Private only' }), reply_text: '',
            delay_seconds: 0, is_active: 1, created_at: 'now', updated_at: 'now',
          }),
        };
      },
    } as unknown as D1Database;

    const response = await commentRules.fetch(
      new Request('https://worker.example/api/comment-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'DM only', matchType: 'any_comment', responseType: 'text',
          responseBody: { text: 'Private only' }, replyText: '   ',
        }),
      }),
      { DB: db },
    );

    expect(response.status).toBe(201);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO comment_rules'));
    expect(insert?.args[8]).toBe('');
  });
});
