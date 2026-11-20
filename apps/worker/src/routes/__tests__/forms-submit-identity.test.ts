import { beforeEach, describe, expect, it, vi } from 'vitest';

type Friend = { id: number; igsid: string; account_id: string; metadata: string; name: string };
const friends: Record<string, Friend> = {
  '1': { id: 1, igsid: '1001', account_id: 'a', metadata: '{}', name: 'victim-a' },
  '2': { id: 2, igsid: '1002', account_id: 'b', metadata: '{}', name: 'other-account' },
};
const submissions: Array<{ formId: string; friendId: string | null }> = [];
const tagged: string[] = [];
const enrolled: string[] = [];
const metadataWrites: unknown[] = [];

const form = {
  id: 'f1', name: 'Form', description: null, fields: '[]', on_submit_tag_id: 't1', on_submit_scenario_id: 's1',
  on_submit_message_type: null, on_submit_message_content: null, save_to_metadata: 1, is_active: 1,
  submit_count: 0, account_id: 'a', created_at: '', updated_at: '',
};

vi.mock('@ig-harness/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getFormById: vi.fn(async (_db: unknown, id: string) => (id === form.id ? form : null)),
  createFormSubmission: vi.fn(async (_db: unknown, input: { formId: string; friendId: string | null; data: string }) => {
    submissions.push({ formId: input.formId, friendId: input.friendId });
    return { id: 'sub1', form_id: input.formId, friend_id: input.friendId, data: input.data, created_at: '' };
  }),
  getFriendById: vi.fn(async (_db: unknown, id: string) => friends[String(id)] ?? null),
  getFriendByLineUserId: vi.fn(async () => friends['1']),
  getIgAccountById: vi.fn(async () => null),
  addTagToFriend: vi.fn(async (_db: unknown, friendId: string) => { tagged.push(String(friendId)); }),
  enrollFriendInScenario: vi.fn(async (_db: unknown, friendId: string) => { enrolled.push(String(friendId)); }),
}));
vi.mock('../../lib/accounts.js', () => ({ resolveAccount: vi.fn(async () => null), getAccountClient: vi.fn() }));

import { forms } from '../forms.js';
import { issueFormToken, issueTrackingToken, TOKEN_TTL } from '../../lib/tracking-token.js';

const db = {
  prepare() {
    return { bind(...args: unknown[]) { return { async run() { metadataWrites.push(args); return { success: true }; } }; } };
  },
} as unknown as D1Database;
const env = { DB: db, API_KEY: 'api-key', TRACKING_SIGNING_SECRET: 'tracking-secret-for-tests' } as any;
const EXEC_CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const submit = (body: unknown, formId = 'f1') => forms.request(
  `/api/forms/${formId}/submit`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  env,
  EXEC_CTX,
);

beforeEach(() => {
  submissions.length = 0; tagged.length = 0; enrolled.length = 0; metadataWrites.length = 0;
});

describe('POST /api/forms/:id/submit identity', () => {
  it.each([
    ['friendId', { friendId: '1' }],
    ['lineUserId', { lineUserId: 'U-victim' }],
    ['both', { friendId: '1', lineUserId: 'U-victim' }],
  ])('ignores an unsigned body %s: stored anonymously with no side effects', async (_label, ids) => {
    const res = await submit({ ...ids, data: { note: 'x' } });
    expect(res.status).toBe(201);
    expect(submissions).toEqual([{ formId: 'f1', friendId: null }]);
    expect(tagged).toHaveLength(0);
    expect(enrolled).toHaveLength(0);
    expect(metadataWrites).toHaveLength(0);
  });

  it('resolves the submitter from a valid signed form token and ignores body ids', async () => {
    const token = await issueFormToken(env, 'f1', '1');
    const res = await submit({ token, friendId: '2', lineUserId: 'U-other', data: { note: 'x' } });
    expect(res.status).toBe(201);
    expect(submissions).toEqual([{ formId: 'f1', friendId: '1' }]);
    expect(tagged).toEqual(['1']);
    expect(enrolled).toEqual(['1']);
    expect(metadataWrites).toHaveLength(1);
  });

  it.each(['tampered', 'expired', 'other-form', 'other-purpose', 'igsid-only', 'not-a-string', 'other-account', 'missing-follower'])(
    'rejects a %s token with 400 and saves nothing',
    async (kind) => {
      let token: unknown;
      if (kind === 'tampered') token = (await issueFormToken(env, 'f1', '1'))!.slice(0, -5) + 'AAAAA';
      if (kind === 'expired') token = await issueFormToken(env, 'f1', '1', Date.now() - (TOKEN_TTL + 1) * 1000);
      if (kind === 'other-form') token = await issueFormToken(env, 'f2', '1');
      if (kind === 'other-purpose') token = await issueTrackingToken(env, { purpose: 'link', linkId: 'f1', followerId: '1' });
      if (kind === 'igsid-only') token = await issueTrackingToken(env, { purpose: 'form', linkId: 'f1', igsid: '1001' });
      if (kind === 'not-a-string') token = { followerId: '1' };
      if (kind === 'other-account') token = await issueFormToken(env, 'f1', '2');
      if (kind === 'missing-follower') token = await issueFormToken(env, 'f1', '999');
      const res = await submit({ token, data: { note: 'x' } });
      expect(res.status).toBe(400);
      expect(submissions).toHaveLength(0);
      expect(tagged).toHaveLength(0);
      expect(enrolled).toHaveLength(0);
    },
  );

  it('POST /api/forms/:id/token issues a token that the submit endpoint accepts', async () => {
    const res = await forms.request('/api/forms/f1/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ followerId: 1 }) }, env, EXEC_CTX);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { token: string } };
    expect((await submit({ token: data.token, data: {} })).status).toBe(201);
    expect(submissions).toEqual([{ formId: 'f1', friendId: '1' }]);
  });

  it.each([
    ['a follower of another account', { followerId: '2' }, 404],
    ['an unknown follower', { followerId: '999' }, 404],
    ['a non-numeric follower id', { followerId: 'abc' }, 400],
    ['no follower id', {}, 400],
  ])('POST /api/forms/:id/token refuses %s', async (_label, body, status) => {
    const res = await forms.request('/api/forms/f1/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env, EXEC_CTX);
    expect(res.status).toBe(status);
  });

  it('POST /api/forms/:id/token requires authentication (not a public route)', async () => {
    const { isPublicRequest } = await import('../../middleware/auth.js');
    expect(isPublicRequest('/api/forms/f1/token', 'POST')).toBe(false);
    expect(isPublicRequest('/api/forms/f1/submit', 'POST')).toBe(true);
  });

  it('issueFormToken refuses a non-numeric follower id', async () => {
    expect(await issueFormToken(env, 'f1', 'abc')).toBeNull();
  });
});
