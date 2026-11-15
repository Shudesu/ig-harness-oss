/**
 * B-18: comment auto-hide (NG words / spam) — settings validation, hiding
 * and the undo path.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseModerationSettings, loadModerationSettings, saveModerationSettings, hideCommentIfModerated, unhideComment, loadHiddenComments } from '../comment-moderation.js';

function mockDb() {
  const settings = new Map<string, string>();
  const stmt = (sql: string, params: unknown[]) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    first: async <T,>() => {
      if (sql.includes('FROM integration_settings') && settings.has(String(params[0]))) return { value: settings.get(String(params[0])) } as T;
      return null as T;
    },
    run: async () => {
      if (sql.includes('INTO integration_settings')) settings.set(String(params[0]), String(params[1]));
      return { meta: {} };
    },
  });
  return { settings, db: { prepare: (sql: string) => stmt(sql, []) } as unknown as D1Database };
}

describe('comment moderation (B-18)', () => {
  it('validates the settings payload', () => {
    expect(parseModerationSettings({ enabled: true, words: ['case', ' spam '] })).toEqual({ enabled: true, words: ['case', 'spam'], mediaIds: null });
    expect(parseModerationSettings(null)).toHaveProperty('error');
    expect(parseModerationSettings({ words: [] })).toHaveProperty('error');
    expect(parseModerationSettings({ enabled: true, words: 'nope' })).toHaveProperty('error');
  });

  it('hides matching comments once and skips gates/rules', async () => {
    const { db, settings } = mockDb();
    await saveModerationSettings(db, 'acc1', { enabled: true, words: ['スパム'], mediaIds: null });
    const hideComment = vi.fn(async () => ({ success: true }));
    const comment = { id: 'c1', text: 'これはスパムです', from: { id: 'u', username: 'user' }, media: { id: 'm1' } };
    expect(await hideCommentIfModerated(db, { hideComment } as never, 'acc1', comment)).toBe(true);
    expect(hideComment).toHaveBeenCalledWith('c1');
    expect((await loadHiddenComments(db, 'acc1'))[0]?.commentId).toBe('c1');
    expect(settings.get('comment_moderation_log:acc1')).toBeTruthy();
    // Non-matching comment is untouched
    expect(await hideCommentIfModerated(db, { hideComment } as never, 'acc1', { ...comment, id: 'c2', text: 'いいね！' })).toBe(false);
    // Disabled → never
    await saveModerationSettings(db, 'acc1', { enabled: false, words: ['スパム'], mediaIds: null });
    expect(await hideCommentIfModerated(db, { hideComment } as never, 'acc1', { ...comment, id: 'c3' })).toBe(false);
  });

  it('media filter restricts moderation to the listed posts', async () => {
    const { db } = mockDb();
    await saveModerationSettings(db, 'acc1', { enabled: true, words: ['spam'], mediaIds: ['m9'] });
    const hideComment = vi.fn(async () => ({ success: true }));
    expect(await hideCommentIfModerated(db, { hideComment } as never, 'acc1', { id: 'c1', text: 'spam', from: {}, media: { id: 'm1' } })).toBe(false);
    expect(await hideCommentIfModerated(db, { hideComment } as never, 'acc1', { id: 'c2', text: 'spam', from: {}, media: { id: 'm9' } })).toBe(true);
  });

  it('hide failures never break the event pipeline', async () => {
    const { db } = mockDb();
    await saveModerationSettings(db, 'acc1', { enabled: true, words: ['spam'], mediaIds: null });
    expect(await hideCommentIfModerated(db, { hideComment: async () => { throw new Error('no permission'); } } as never, 'acc1', { id: 'c1', text: 'spam', from: {}, media: { id: 'm' } })).toBe(false);
  });

  it('unhide marks the log entry as undone', async () => {
    const { db } = mockDb();
    await saveModerationSettings(db, 'acc1', { enabled: true, words: ['spam'], mediaIds: null });
    const hideComment = vi.fn(async () => ({ success: true }));
    await hideCommentIfModerated(db, { hideComment } as never, 'acc1', { id: 'c1', text: 'spam', from: { username: 'u' }, media: { id: 'm1' } });
    const result = await unhideComment(db, { unhideComment: async () => ({ success: true }) } as never, 'acc1', 'c1');
    expect(result.ok).toBe(true);
    const entry = (await loadHiddenComments(db, 'acc1'))[0]!;
    expect(entry.undoneAt).toBeTruthy();
    expect(entry.commentId).toBe('c1');
  });

  it('round-trips the settings through integration_settings', async () => {
    const { db, settings } = mockDb();
    await saveModerationSettings(db, 'acc1', { enabled: true, words: ['a'], mediaIds: ['m1'] });
    expect(await loadModerationSettings(db, 'acc1')).toEqual({ enabled: true, words: ['a'], mediaIds: ['m1'] });
    expect(settings.get('comment_moderation:acc1')).toBeTruthy();
  });
});
