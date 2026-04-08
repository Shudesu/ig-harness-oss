import { describe, it, expect } from 'vitest';
import { parsePostbackPayload } from '../webhook.js';

describe('parsePostbackPayload', () => {
  it('parses CHECK_FOLLOW payload', () => {
    expect(parsePostbackPayload('CHECK_FOLLOW:gate-1:delivery-2')).toEqual({
      kind: 'check_follow',
      gateId: 'gate-1',
      deliveryId: 'delivery-2',
    });
  });

  it('returns unknown for malformed payload', () => {
    expect(parsePostbackPayload('FOO')).toEqual({ kind: 'unknown' });
    expect(parsePostbackPayload('CHECK_FOLLOW:gate-1')).toEqual({ kind: 'unknown' });
  });

  it('returns unknown for empty payload', () => {
    expect(parsePostbackPayload('')).toEqual({ kind: 'unknown' });
  });
});
