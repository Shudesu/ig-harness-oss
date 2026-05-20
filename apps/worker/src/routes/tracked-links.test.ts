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

describe('tracked links route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
