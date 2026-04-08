import { describe, it, expect } from 'vitest';
import { linkLineFriend, verifyLinkSecret } from '../cross-link.js';

function createMockDb() {
  const followers: any[] = [];
  return {
    followers,
    prepare(sql: string) {
      const make = (params: unknown[]) => ({
        async run() {
          if (sql.startsWith('UPDATE followers') && sql.includes('line_friend_uuid')) {
            const f = followers.find((x) => x.igsid === params[1]);
            if (f) { f.line_friend_uuid = params[0]; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() { return null; },
        async all() { return { results: [] }; },
      });
      return {
        ...make([]),
        bind(...params: unknown[]) { return make(params); },
      };
    },
  } as unknown as D1Database & { followers: any[] };
}

describe('verifyLinkSecret', () => {
  it('returns true when header matches secret (timing-safe)', () => {
    expect(verifyLinkSecret('secret-abc', 'secret-abc')).toBe(true);
  });

  it('returns false on mismatch', () => {
    expect(verifyLinkSecret('secret-abc', 'wrong')).toBe(false);
  });

  it('returns false when header missing', () => {
    expect(verifyLinkSecret('secret-abc', undefined)).toBe(false);
    expect(verifyLinkSecret('secret-abc', '')).toBe(false);
  });

  it('returns false when configured secret is empty', () => {
    expect(verifyLinkSecret('', 'whatever')).toBe(false);
  });
});

describe('linkLineFriend', () => {
  it('writes line_friend_uuid to follower by igsid', async () => {
    const db = createMockDb();
    db.followers.push({ id: 1, igsid: 'IGSID42', line_friend_uuid: null });

    const ok = await linkLineFriend(db, { igsid: 'IGSID42', lineFriendUuid: 'line-uuid-xyz' });

    expect(ok).toBe(true);
    expect(db.followers[0].line_friend_uuid).toBe('line-uuid-xyz');
  });

  it('returns false when follower not found', async () => {
    const db = createMockDb();
    const ok = await linkLineFriend(db, { igsid: 'NOPE', lineFriendUuid: 'x' });
    expect(ok).toBe(false);
  });
});
