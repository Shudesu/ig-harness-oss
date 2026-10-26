import { it, expect } from 'vitest';
import { timingSafeEqualStr } from './timing-safe.js';
import { verifyWebhookChallenge } from './webhook.js';
it('compares nonempty values and rejects empty/missing values', async () => {
  expect(await timingSafeEqualStr('secret', 'secret')).toBe(true);
  for (const [a, b] of [['secret','other'], ['short','much-longer'], ['', ''], [undefined, undefined], [null, 'x']]) expect(await timingSafeEqualStr(a,b)).toBe(false);
});
it('awaits the challenge token comparison and refuses empty configured secrets', async () => {
  expect(await verifyWebhookChallenge('subscribe','secret','123','secret')).toBe('123');
  expect(await verifyWebhookChallenge('subscribe','wrong','123','secret')).toBeNull();
  expect(await verifyWebhookChallenge('subscribe','','123','')).toBeNull();
});
