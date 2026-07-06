import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from './webhook.js';

/**
 * Compute a real HMAC-SHA256 hex using the Web Crypto API (same as production).
 * Returns the full "sha256=..." prefixed string that Meta sends.
 */
async function computeSignature(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('verifyWebhookSignature', () => {
  const secret = 'test-app-secret-abc123';
  const body = '{"object":"instagram","entry":[]}';

  it('returns true for a correct HMAC-SHA256 signature', async () => {
    const sig = await computeSignature(body, secret);
    expect(await verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it('returns false for an invalid signature', async () => {
    const wrongSig = 'sha256=' + 'a'.repeat(64);
    expect(await verifyWebhookSignature(body, wrongSig, secret)).toBe(false);
  });

  it('returns false for a signature with wrong secret', async () => {
    const sig = await computeSignature(body, 'different-secret');
    expect(await verifyWebhookSignature(body, sig, secret)).toBe(false);
  });

  it('returns false for an empty/missing signature', async () => {
    expect(await verifyWebhookSignature(body, '', secret)).toBe(false);
  });

  it('returns false for a length-mismatched signature (prevents trivial bypass)', async () => {
    // Short string that could pass non-constant-time compare if it happens to match prefix
    expect(await verifyWebhookSignature(body, 'sha256=abc', secret)).toBe(false);
  });

  it('returns false when body differs from signed content', async () => {
    const sig = await computeSignature(body, secret);
    const tamperedBody = body + ' ';
    expect(await verifyWebhookSignature(tamperedBody, sig, secret)).toBe(false);
  });
});
