import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackedLinks } from './tracked-links.js';

const dbMocks = vi.hoisted(() => ({
  addTagToFriend: vi.fn(),
  createTrackedLink: vi.fn(),
  deleteTrackedLink: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getFriendByIgsid: vi.fn(),
  getLinkClicks: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getTrackedLinks: vi.fn(),
  recordLinkClick: vi.fn(),
}));

vi.mock('@ig-harness/db', () => dbMocks);
vi.mock('../lib/accounts.js', () => ({ resolveAccount: vi.fn().mockResolvedValue({ id: 'a' }) }));

function makeExecutionCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as ExecutionContext,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('tracked links route', () => {

  it('resolves friend attribution from the ig query parameter before recording the click', async () => {
    dbMocks.getTrackedLinkById.mockResolvedValue({
      id: 'link-1',
      name: 'Reward',
      original_url: 'https://example.com/reward',
      tag_id: 'tag-1',
      scenario_id: 'scenario-1',
      is_active: 1,
      click_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    dbMocks.getFriendByIgsid.mockResolvedValue({ id: 'friend-1' });
    dbMocks.recordLinkClick.mockResolvedValue({ id: 'click-1' });
    dbMocks.addTagToFriend.mockResolvedValue(undefined);
    dbMocks.enrollFriendInScenario.mockResolvedValue(undefined);

    const env = { DB: {} as D1Database };
    const { ctx, pending } = makeExecutionCtx();
    const response = await trackedLinks.fetch(
      new Request('https://worker.example.com/t/link-1?ig=IGSID42'),
      env,
      ctx,
    );
    await Promise.all(pending);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://example.com/reward');
    expect(dbMocks.getFriendByIgsid).toHaveBeenCalledWith(env.DB, 'IGSID42');
    expect(dbMocks.recordLinkClick).toHaveBeenCalledWith(env.DB, 'link-1', 'friend-1');
    expect(dbMocks.addTagToFriend).toHaveBeenCalledWith(env.DB, 'friend-1', 'tag-1');
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(env.DB, 'friend-1', 'scenario-1');
  });
});

for (const originalUrl of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://user:password@example.com']) {
  it(`rejects unsafe tracked destinations: ${originalUrl.split(':')[0]}`, async () => {
    const result = await trackedLinks.fetch(new Request('https://worker.example/api/tracked-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'unsafe', originalUrl }) }), { DB: {} } as any);
    expect(result.status).toBe(400); expect(dbMocks.createTrackedLink).not.toHaveBeenCalled();
  });
}
it('rejects unsafe legacy URLs before recording clicks', async () => {
  dbMocks.getTrackedLinkById.mockResolvedValue({ is_active: 1, original_url: 'javascript:alert(1)' });
  const result = await trackedLinks.fetch(new Request('https://worker.example/t/1'), { DB: {} } as any);
  expect(result.status).toBe(404); expect(dbMocks.recordLinkClick).not.toHaveBeenCalled();
});
it('serializes redirect URLs as JS strings and restricts execution to the nonce', async () => {
  const url = 'https://github.com/test?q=</script><script>alert(1)</script>&a="quoted"\u2028\u2029';
  dbMocks.getTrackedLinkById.mockResolvedValue({ id: 1, is_active: 1, original_url: url });
  const { ctx, pending } = makeExecutionCtx();
  const result = await trackedLinks.fetch(new Request('https://worker.example/t/1'), { DB: {} } as any, ctx);
  await Promise.all(pending);
  const html = await result.text();
  expect(html).not.toContain('</script><script>'); expect(html.match(/<script\b/g)).toHaveLength(1);
  const literal = html.match(/var target = (.*);/)![1]!;
  expect(literal).toContain('\\u003c'); expect(literal).toContain('\\u2028'); expect(JSON.parse(literal)).toBe(url);
  const nonce = html.match(/<script nonce="([a-f0-9]+)"/)![1]!;
  expect(result.headers.get('Content-Security-Policy')).toContain(`script-src 'nonce-${nonce}'`);
});
