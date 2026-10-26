/**
 * Tests: validateMediaPostInput — post_type × media integrity rules.
 * Also: normalizeScheduledAt — JST interpretation of offset-less input
 * (final review Fix 2).
 */
import { describe, it, expect } from 'vitest';
import { validateMediaPostInput, normalizeScheduledAt } from '../media-posts.js';

const img = { url: 'https://example.com/a.jpg', type: 'image' as const };
const vid = { url: 'https://example.com/v.mp4', type: 'video' as const };

describe('validateMediaPostInput', () => {
  it('accepts a single-image feed post', () => {
    expect(validateMediaPostInput('feed_image', [img])).toBeNull();
  });
  it('rejects feed_image with a video', () => {
    expect(validateMediaPostInput('feed_image', [vid])).toMatch(/image/);
  });
  it('rejects feed_image with 2 items', () => {
    expect(validateMediaPostInput('feed_image', [img, img])).toMatch(/1/);
  });
  it('accepts a reel with a single video', () => {
    expect(validateMediaPostInput('reel', [vid])).toBeNull();
  });
  it('rejects a reel with an image', () => {
    expect(validateMediaPostInput('reel', [img])).toMatch(/video/);
  });
  it('accepts a story with image or video', () => {
    expect(validateMediaPostInput('story', [img])).toBeNull();
    expect(validateMediaPostInput('story', [vid])).toBeNull();
  });
  it('accepts a carousel with 2-10 items', () => {
    expect(validateMediaPostInput('carousel', [img, vid])).toBeNull();
  });
  it('rejects a carousel with 1 item', () => {
    expect(validateMediaPostInput('carousel', [img])).toMatch(/2/);
  });
  it('rejects a carousel with 11 items', () => {
    expect(validateMediaPostInput('carousel', Array(11).fill(img))).toMatch(/10/);
  });
  it('rejects an unknown post_type', () => {
    expect(validateMediaPostInput('album' as never, [img])).toMatch(/post_type/);
  });
  it('rejects non-http URLs', () => {
    expect(
      validateMediaPostInput('feed_image', [{ url: 'ftp://x/a.jpg', type: 'image' }]),
    ).toMatch(/URL/i);
  });
  it('rejects empty media', () => {
    expect(validateMediaPostInput('story', [])).toMatch(/media/);
  });
});

describe('reel cover validation', () => {
  it('accepts an image URL or a frame offset including zero', () => {
    for (const option of [{ coverUrl: 'https://example.com/cover.jpg' }, { thumbOffset: 0 }, { thumbOffset: 1500 }]) {
      expect(validateMediaPostInput('reel', [{ ...vid, ...option }])).toBeNull();
    }
  });
  it('rejects both choices instead of silently ignoring the frame', () => {
    expect(validateMediaPostInput('reel', [{ ...vid, coverUrl: 'https://example.com/c.jpg', thumbOffset: 0 }])).toMatch(/どちらか/);
  });
  it.each(['story', 'feed_image', 'carousel'] as const)('rejects reel options on %s', (postType) => {
    expect(validateMediaPostInput(postType, [{ ...img, thumbOffset: 0 }])).toMatch(/リール専用/);
  });
  it.each(['', 'not a url', 'https://', 'data:image/jpeg;base64,AA', 'file:///c.jpg', 'https://user:pass@example.com/c.jpg', 'https://example.com/c.jpg#preview', null, 1])('rejects invalid cover URL %s', (coverUrl) => {
    expect(validateMediaPostInput('reel', [{ ...vid, coverUrl } as never])).toMatch(/coverUrl/);
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1000', null])('rejects invalid frame offset %s', (thumbOffset) => {
    expect(validateMediaPostInput('reel', [{ ...vid, thumbOffset } as never])).toMatch(/thumbOffset/);
  });
});

describe('normalizeScheduledAt', () => {
  it('interprets an offset-less string as JST', () => {
    const result = normalizeScheduledAt('2026-07-24T09:00:00');
    expect(result).not.toBeNull();
    expect(result).toContain('09:00:00.000+09:00');
  });

  it('converts a Z string to the equivalent JST wall time', () => {
    const result = normalizeScheduledAt('2026-07-24T00:00:00Z');
    expect(result).not.toBeNull();
    expect(result).toContain('09:00:00.000+09:00');
  });

  it('passes an explicit +09:00 string through as the same instant', () => {
    const result = normalizeScheduledAt('2026-07-24T09:00:00+09:00');
    expect(result).not.toBeNull();
    expect(result).toContain('09:00:00.000+09:00');
  });

  it('returns null for unparseable input', () => {
    expect(normalizeScheduledAt('not-a-date')).toBeNull();
  });
});
