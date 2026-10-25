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
