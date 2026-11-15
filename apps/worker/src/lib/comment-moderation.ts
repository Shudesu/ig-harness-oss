// B-18: comment auto-hide (NG words / spam) as a rule configured from the
// admin API and MCP. Matches hide the comment via POST /{comment-id}/hide,
// keep a bounded log (with the info needed to undo), and skip gates/rules.
// Nothing is destructive: hiding is reversible with POST /{comment-id}/unhide.
import { InstagramClient } from '@ig-harness/ig-sdk';

export interface CommentModerationSettings {
  enabled: boolean;
  /** Substrings matched case-insensitively against the comment text. */
  words: string[];
  /** When set, only comments on these media are moderated (null = all). */
  mediaIds: string[] | null;
}

export interface HiddenCommentEntry {
  commentId: string;
  mediaId: string | null;
  username: string | null;
  matchedWord: string;
  /** First 200 chars only — the full text lives on Instagram. */
  textSnippet: string;
  hiddenAt: string;
  undoneAt: string | null;
}

const settingsKey = (accountId: string) => `comment_moderation:${accountId}`;
const logKey = (accountId: string) => `comment_moderation_log:${accountId}`;
const LOG_LIMIT = 100;

export const DEFAULT_MODERATION_SETTINGS: CommentModerationSettings = { enabled: false, words: [], mediaIds: null };

export async function loadModerationSettings(db: D1Database, accountId: string): Promise<CommentModerationSettings> {
  const row = await db.prepare('SELECT value FROM integration_settings WHERE key = ?').bind(settingsKey(accountId)).first<{ value: string }>();
  if (!row?.value) return { ...DEFAULT_MODERATION_SETTINGS };
  try { return { ...DEFAULT_MODERATION_SETTINGS, ...(JSON.parse(row.value) as CommentModerationSettings) }; } catch { return { ...DEFAULT_MODERATION_SETTINGS }; }
}

export async function saveModerationSettings(db: D1Database, accountId: string, settings: CommentModerationSettings): Promise<void> {
  await db.prepare(
    `INSERT INTO integration_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
  ).bind(settingsKey(accountId), JSON.stringify(settings)).run();
}

/** Validate the payload shape (words are bounded so the setting can't blow up). */
export function parseModerationSettings(input: unknown): CommentModerationSettings | { error: string } {
  const value = input as Partial<CommentModerationSettings> | null;
  if (!value || typeof value !== 'object') return { error: 'settings object is required' };
  const enabled = value.enabled;
  if (typeof enabled !== 'boolean') return { error: 'enabled (boolean) is required' };
  const words = value.words;
  if (words !== undefined && (!Array.isArray(words) || words.some((w) => typeof w !== 'string') || words.length > 200)) {
    return { error: 'words must be an array of at most 200 strings' };
  }
  const mediaIds = value.mediaIds;
  if (mediaIds !== undefined && mediaIds !== null && (!Array.isArray(mediaIds) || mediaIds.some((m) => typeof m !== 'string') || mediaIds.length > 100)) {
    return { error: 'mediaIds must be null or an array of at most 100 ids' };
  }
  return {
    enabled,
    words: (words ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 200),
    mediaIds: mediaIds === undefined ? null : mediaIds,
  };
}

export async function loadHiddenComments(db: D1Database, accountId: string): Promise<HiddenCommentEntry[]> {
  const row = await db.prepare('SELECT value FROM integration_settings WHERE key = ?').bind(logKey(accountId)).first<{ value: string }>();
  if (!row?.value) return [];
  try { return JSON.parse(row.value) as HiddenCommentEntry[]; } catch { return []; }
}

async function appendHiddenComment(db: D1Database, accountId: string, entry: HiddenCommentEntry): Promise<void> {
  const log = (await loadHiddenComments(db, accountId)).filter((e) => e.commentId !== entry.commentId);
  log.unshift(entry);
  await db.prepare(
    `INSERT INTO integration_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
  ).bind(logKey(accountId), JSON.stringify(log.slice(0, LOG_LIMIT))).run();
}

async function markUndone(db: D1Database, accountId: string, commentId: string): Promise<boolean> {
  const log = await loadHiddenComments(db, accountId);
  let changed = false;
  const next = log.map((entry) => {
    if (entry.commentId !== commentId || entry.undoneAt) return entry;
    changed = true;
    return { ...entry, undoneAt: new Date().toISOString() };
  });
  if (changed) {
    await db.prepare(
      `INSERT INTO integration_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))`,
    ).bind(logKey(accountId), JSON.stringify(next)).run();
  }
  return changed;
}

/**
 * Check a comment against the moderation settings and hide it on match.
 * Returns true when the comment was hidden (caller must skip gate/rules).
 */
export async function hideCommentIfModerated(
  db: D1Database,
  client: Pick<InstagramClient, 'hideComment'>,
  accountId: string,
  value: { id: string; text: string; from?: { id?: string; username?: string }; media?: { id?: string } },
): Promise<boolean> {
  const settings = await loadModerationSettings(db, accountId);
  if (!settings.enabled || !settings.words.length) return false;
  if (settings.mediaIds?.length && (!value.media?.id || !settings.mediaIds.includes(value.media.id))) return false;
  const text = value.text ?? '';
  const matched = settings.words.find((word) => text.toLowerCase().includes(word.toLowerCase()));
  if (!matched) return false;
  try {
    await client.hideComment(value.id);
  } catch {
    // A permission or API problem must not break the event pipeline.
    return false;
  }
  await appendHiddenComment(db, accountId, {
    commentId: value.id,
    mediaId: value.media?.id ?? null,
    username: value.from?.username ?? null,
    matchedWord: matched,
    textSnippet: text.slice(0, 200),
    hiddenAt: new Date().toISOString(),
    undoneAt: null,
  });
  return true;
}

/** Undo a hide (元に戻す). */
export async function unhideComment(
  db: D1Database,
  client: Pick<InstagramClient, 'unhideComment'>,
  accountId: string,
  commentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await client.unhideComment(commentId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unhide failed' };
  }
  const changed = await markUndone(db, accountId, commentId);
  return { ok: true, ...(changed ? {} : { error: 'comment was not in the hidden log (marked undone anyway)' }) };
}
