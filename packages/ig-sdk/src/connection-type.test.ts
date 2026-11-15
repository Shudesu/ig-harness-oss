import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramClient, detectTokenConnectionType, graphHost } from './client.js';

afterEach(() => { vi.unstubAllGlobals(); });
const ok = (body: unknown) => new Response(JSON.stringify(body));

describe('detectTokenConnectionType', () => {
  it('maps EAA tokens to Facebook Login and IG tokens to Instagram Login', () => {
    expect(detectTokenConnectionType('EAAGm0PX4ZCpsBA')).toBe('facebook_login');
    expect(detectTokenConnectionType('  EAAx  ')).toBe('facebook_login');
    expect(detectTokenConnectionType('IGAAKxyz')).toBe('instagram_login');
    expect(detectTokenConnectionType('IGQVJxyz')).toBe('instagram_login');
    expect(detectTokenConnectionType('opaque-test-token')).toBeNull();
  });
  it('chooses the Graph host per connection type', () => {
    expect(graphHost()).toBe('https://graph.instagram.com');
    expect(graphHost('facebook_login')).toBe('https://graph.facebook.com');
  });
});

describe('InstagramClient with Facebook Login (Unified login)', () => {
  it('keeps graph.instagram.com and /me for the default Instagram Login client', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ user_id: '1', username: 'u' })); vi.stubGlobal('fetch', fetch);
    await new InstagramClient({ accessToken: 't', igUserId: '1' }).getMe();
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://graph.instagram.com/v25.0/me?fields=user_id,username');
  });

  it('sends comments, replies, DMs and media reads to graph.facebook.com with the IG user id', async () => {
    const fetch = vi.fn().mockImplementation(async () => ok({ id: 'x', recipient_id: 'r', message_id: 'm', data: [] })); vi.stubGlobal('fetch', fetch);
    const client = new InstagramClient({ accessToken: 'EAAtoken', igUserId: '17841400000000000', connectionType: 'facebook_login' });
    await client.getMediaComments('media-1');
    await client.replyToComment('comment-1', 'thanks');
    await client.sendPrivateReply('comment-2', 'hello');
    await client.sendText('igsid-1', 'hi');
    await client.getMyMedia();
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    for (const url of urls) expect(url.origin).toBe('https://graph.facebook.com');
    expect(urls.map((u) => u.pathname)).toEqual([
      '/v25.0/media-1/comments', '/v25.0/comment-1/replies', '/v25.0/17841400000000000/messages', '/v25.0/17841400000000000/messages', '/v25.0/17841400000000000/media',
    ]);
    for (const [url, init] of fetch.mock.calls) { expect(String(url)).not.toContain('EAAtoken'); expect(init.headers.Authorization).toBe('Bearer EAAtoken'); }
  });

  it('uses the linked Page as messaging and subscription node when one is known', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(ok({ recipient_id: 'r', message_id: 'm' }))
      .mockResolvedValueOnce(ok({ success: true }))
      .mockResolvedValueOnce(ok({ data: [{ subscribed_fields: ['messages', 'messaging_postbacks', 'messaging_referral', 'comments'] }] }));
    vi.stubGlobal('fetch', fetch);
    const client = new InstagramClient({ accessToken: 'EAA', igUserId: '178', pageId: '555', connectionType: 'facebook_login' });
    await client.sendText('igsid', 'hi');
    await expect(client.subscribeWebhooks()).resolves.toEqual({ node: '555', fields: ['messages', 'messaging_postbacks', 'messaging_referral', 'comments'] });
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[0]?.pathname).toBe('/v25.0/555/messages');
    expect(urls[1]?.pathname).toBe('/v25.0/555/subscribed_apps');
    expect(urls[1]?.searchParams.get('subscribed_fields')).toBe('messages,messaging_postbacks,messaging_referral,comments');
    expect(fetch.mock.calls[1]?.[1].method).toBe('POST');
  });

  it('subscribes the IG user on Instagram Login and reports missing fields', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({ success: true })).mockResolvedValueOnce(ok({ data: [{ subscribed_fields: ['messages'] }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(new InstagramClient({ accessToken: 'IGAA', igUserId: '178' }).subscribeWebhooks()).rejects.toThrow('messaging_postbacks');
    expect(new URL(String(fetch.mock.calls[0]?.[0])).origin + new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe('https://graph.instagram.com/v25.0/178/subscribed_apps');
  });

  it('reads the IG user node instead of /me and returns it in the Instagram Login shape', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ id: '178', username: 'owner' })); vi.stubGlobal('fetch', fetch);
    const me = await new InstagramClient({ accessToken: 'EAA', igUserId: '178', connectionType: 'facebook_login' }).getMe();
    expect(me).toEqual({ user_id: '178', username: 'owner', id: '178' });
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://graph.facebook.com/v25.0/178?fields=id,username');
    await expect(new InstagramClient({ accessToken: 'EAA', igUserId: 'me', connectionType: 'facebook_login' }).getMe()).rejects.toThrow('numeric');
  });

  it('lists Unified login assigned IG accounts first, then falls back to Page-linked accounts', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({ data: [{ id: '178', username: 'owner' }] }));
    vi.stubGlobal('fetch', fetch);
    const client = new InstagramClient({ accessToken: 'EAA', igUserId: 'me', connectionType: 'facebook_login' });
    expect(await client.listLinkedInstagramAccounts()).toEqual([{ igUserId: '178', username: 'owner' }]);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe('/v25.0/me/assigned_instagram_accounts');

    fetch.mockReset()
      .mockResolvedValueOnce(new Response('{"error":{"code":100}}', { status: 400 }))
      .mockResolvedValueOnce(ok({ data: [
        { id: 'p1', name: 'Page 1', instagram_business_account: { id: '179', username: 'shop' } },
        { id: 'p2', name: 'No IG' },
      ] }));
    expect(await client.listLinkedInstagramAccounts()).toEqual([{ pageId: 'p1', pageName: 'Page 1', igUserId: '179', username: 'shop' }]);
    expect(new URL(String(fetch.mock.calls[1]?.[0])).pathname).toBe('/v25.0/me/accounts');
    await expect(new InstagramClient({ accessToken: 'IG', igUserId: 'me' }).listLinkedInstagramAccounts()).rejects.toThrow('Facebook Login');
  });

  it('rejects unknown connection types', () => {
    expect(() => new InstagramClient({ accessToken: 't', igUserId: '1', connectionType: 'x' as never })).toThrow('connection type');
  });
});
