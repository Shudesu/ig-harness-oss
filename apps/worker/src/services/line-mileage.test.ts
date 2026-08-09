import { describe, expect, it, vi } from 'vitest';
import { forwardLinkedInstagramEngagement } from './line-mileage.js';

function fakeDb(lineFriendUuid: string | null) {
  const connections = [
    { id: 'default', worker_url: 'https://line-a.example.com/', api_key: 'key-a', is_default: 1 },
    { id: 'other', worker_url: 'https://line-b.example.com', api_key: 'key-b', is_default: 0 },
  ];
  return {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first() { return sql.includes('FROM followers') ? { line_friend_uuid: lineFriendUuid } : null; },
        async all() { return { results: connections }; },
      };
    },
  } as unknown as D1Database;
}

describe('forwardLinkedInstagramEngagement', () => {
  it('does nothing until IG and LINE identities are linked', async () => {
    const fetchImpl = vi.fn();
    expect(await forwardLinkedInstagramEngagement(fakeDb(null), {
      followerId: 1, eventType: 'instagram_dm_received', sourceEventId: 'mid-1',
    }, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('tries registered Harness connections until the linked UUID is found', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await forwardLinkedInstagramEngagement(fakeDb('line-friend-1'), {
      followerId: 7,
      eventType: 'instagram_comment_created',
      sourceEventId: 'comment-1',
      subjectKey: 'media-1',
      metadata: { accountId: 'ig-account-1' },
    }, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://line-b.example.com/api/integrations/ig-harness/engagement',
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string)).toMatchObject({
      friendId: 'line-friend-1',
      eventType: 'instagram_comment_created',
      sourceEventId: 'comment-1',
    });
  });
});
