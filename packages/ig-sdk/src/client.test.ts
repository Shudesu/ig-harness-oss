import { afterEach, it, expect, vi } from 'vitest';
import { InstagramClient } from './client.js';
import { InstagramApiError } from './errors.js';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('never puts access tokens in media URLs', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"data":[]}')); vi.stubGlobal('fetch', fetch);
  const client = new InstagramClient({ accessToken: 'SECRET', igUserId: '123' });
  await client.getMyMedia(); fetch.mockResolvedValue(new Response('{"data":[]}')); await client.getMediaComments('456');
  for (const [url, init] of fetch.mock.calls) { expect(url).not.toContain('SECRET'); expect(init.headers.Authorization).toBe('Bearer SECRET'); }
});
it('exposes typed token expiry without leaking upstream text and does not retry a mutation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"error":{"code":190,"message":"SECRET"}}', { status: 401 })); vi.stubGlobal('fetch', fetch);
  const client = new InstagramClient({ accessToken: 'SECRET', igUserId: '123' });
  const error = await client.sendText('456', 'test').catch((e) => e);
  expect(error).toBeInstanceOf(InstagramApiError); expect(error.tokenExpired).toBe(true); expect(error.message).not.toContain('SECRET'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('retries an idempotent read on 429 but never a POST on 5xx', async () => {
  vi.useFakeTimers(); const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429 })).mockResolvedValueOnce(new Response('{"username":"owner"}')); vi.stubGlobal('fetch', fetch);
  const client = new InstagramClient({ accessToken: 'test', igUserId: '123' }); const result = client.getMe(); await vi.runAllTimersAsync(); expect(await result).toMatchObject({ username: 'owner' }); expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockReset().mockResolvedValue(new Response('{}', { status: 503 })); await expect(client.sendText('456','test')).rejects.toMatchObject({ status: 503 }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('aborts timed-out requests and validates large rich messages before sending', async () => {
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
  const client = new InstagramClient({ accessToken: 'test', igUserId: '123', timeoutMs: 10, maxReadRetries: 0 });
  await expect(client.getMe()).rejects.toMatchObject({ timedOut: true });
  await expect(client.sendRichMessage('456', Array.from({ length: 11 }, () => ({ type: 'text' as const, text: 'test' })))).rejects.toThrow('at most');
});
it('posts a public reply to the documented /{comment-id}/replies endpoint', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"id":"r1"}')); vi.stubGlobal('fetch', fetch);
  const client = new InstagramClient({ accessToken: 'test', igUserId: '123' });
  expect(await client.replyToComment('c-9', 'ありがとう @you')).toEqual({ id: 'r1' });
  const [url, init] = fetch.mock.calls[0]!; const parsed = new URL(url);
  expect(init.method).toBe('POST'); expect(parsed.pathname).toMatch(/\/c-9\/replies$/); expect(parsed.searchParams.get('message')).toBe('ありがとう @you');
});
it('sends sender actions without a message payload (mark_seen / typing_on)', async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response('{}')); vi.stubGlobal('fetch', fetch);
  const client = new InstagramClient({ accessToken: 'test', igUserId: '123' });
  await client.sendSenderAction('456', 'mark_seen');
  await client.sendSenderAction('456', 'typing_on');
  const bodies = fetch.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
  expect(bodies[0]).toEqual({ recipient: { id: '456' }, sender_action: 'mark_seen' });
  expect(bodies[1]).toEqual({ recipient: { id: '456' }, sender_action: 'typing_on' });
  // Sender actions are never passed through message rewriting hooks.
  const transformed = new InstagramClient({ accessToken: 'test', igUserId: '123', transformMessage: async () => { throw new Error('should not be called'); } });
  fetch.mockClear().mockImplementation(async () => new Response('{}'));
  await transformed.sendSenderAction('456', 'typing_off');
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(client.sendSenderAction('', 'mark_seen')).rejects.toThrow('recipient');
});
it('subscribes the account to webhook fields and reads them back', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{"success":true}')).mockResolvedValueOnce(new Response('{"data":[{"subscribed_fields":["messages","comments"]}]}')); vi.stubGlobal('fetch', fetch);
  const client = new InstagramClient({ accessToken: 'test', igUserId: '123' });
  await client.subscribeApp(['messages', 'comments']);
  expect(await client.getSubscribedFields()).toEqual(['messages', 'comments']);
  const post = new URL(fetch.mock.calls[0]![0]); expect(fetch.mock.calls[0]![1].method).toBe('POST');
  expect(post.pathname).toMatch(/\/123\/subscribed_apps$/); expect(post.searchParams.get('subscribed_fields')).toBe('messages,comments');
  await expect(client.subscribeApp(['bad field'])).rejects.toThrow();
});
it('keeps Meta error message/type for operators but masks token-like strings', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":10,"type":"OAuthException","message":"(#10) No permission access_token=IGAAsecretsecret123"}}', { status: 400 })));
  const client = new InstagramClient({ accessToken: 'test', igUserId: '123' });
  const error = await client.replyToComment('c', 'x').catch((e) => e);
  expect(error.metaMessage).toBe('(#10) No permission access_token=****'); expect(error.metaType).toBe('OAuthException'); expect(error.message).not.toContain('No permission');
});
it('reads the real follower count from the IG user node', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"followers_count":73}')); vi.stubGlobal('fetch', fetch);
  const client = new InstagramClient({ accessToken: 'test', igUserId: '123' });
  await expect(client.getMyFollowerCount()).resolves.toBe(73);
  expect(String(fetch.mock.calls[0][0])).toContain('followers_count');
  fetch.mockResolvedValue(new Response('{}'));
  await expect(client.getMyFollowerCount()).resolves.toBeNull();
});
