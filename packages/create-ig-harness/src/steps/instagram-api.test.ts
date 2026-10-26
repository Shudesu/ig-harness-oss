import { it, expect, vi, afterEach } from 'vitest';
import { validateInstagramToken, subscribeInstagramAccount, WEBHOOK_FIELDS } from './instagram-api.js';
afterEach(() => vi.unstubAllGlobals());
it('requires user_id from Instagram Login rather than accepting app-scoped id', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{"id":"wrong","username":"owner"}')); vi.stubGlobal('fetch', request);
  await expect(validateInstagramToken('test')).rejects.toThrow('user_id');
  request.mockResolvedValue(new Response('{"user_id":"123","username":"owner"}'));
  expect(await validateInstagramToken('test')).toEqual({ userId: '123', username: 'owner' });
  expect(request.mock.calls[0]?.[0]).not.toContain('test');
});
it('verifies an account subscription and rejects missing fields', async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response('{"success":true}')).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ subscribed_fields: WEBHOOK_FIELDS }] }))); vi.stubGlobal('fetch', request);
  await subscribeInstagramAccount('test','123'); expect(request.mock.calls[0]?.[1].method).toBe('POST'); expect(request.mock.calls[1]?.[1].method).toBe('GET');
  request.mockResolvedValueOnce(new Response('{"success":true}')).mockResolvedValueOnce(new Response('{"data":[]}'));
  await expect(subscribeInstagramAccount('test','123')).rejects.toThrow('incomplete');
});
