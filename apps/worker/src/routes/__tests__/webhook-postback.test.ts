import { describe, it, expect } from 'vitest';
import { isStoryMentionMessagingEvent, parsePostbackPayload } from '../webhook.js';

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

describe('story mention messaging events', () => {
  const base = {
    sender: { id: 'sender' },
    recipient: { id: 'business' },
    timestamp: 1,
  };

  it('recognizes referral and attachment payloads', () => {
    expect(isStoryMentionMessagingEvent({
      ...base,
      referral: { source: 'STORY_MENTION', type: 'OPEN_THREAD' },
    })).toBe(true);
    expect(isStoryMentionMessagingEvent({
      ...base,
      message: {
        mid: 'mid-story',
        attachments: [{ type: 'story_mention', payload: { url: 'https://example.com/story' } }],
      },
    })).toBe(true);
  });

  it('does not mistake ordinary referrals or media messages for story mentions', () => {
    expect(isStoryMentionMessagingEvent({
      ...base,
      referral: { source: 'IGME', ref: 'campaign-link', type: 'OPEN_THREAD' },
    })).toBe(false);
    expect(isStoryMentionMessagingEvent({
      ...base,
      message: {
        mid: 'mid-image',
        attachments: [{ type: 'image', payload: { url: 'https://example.com/image.jpg' } }],
      },
    })).toBe(false);
  });
});
