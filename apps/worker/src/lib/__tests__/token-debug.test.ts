/**
 * B-04: debug_token inspection. Verifies scope diffing, expiry mapping and
 * graceful "unknown" degradation when Meta cannot be asked.
 */
import { describe, it, expect, vi } from 'vitest';
import { debugAccountToken, IG_REQUIRED_SCOPES, saveTokenDebug, loadTokenDebug } from '../token-debug.js';

const baseAccount = {
  id: 'acc1',
  ig_user_id: '111',
  access_token: 'IGAA' + 'x'.repeat(40),
  app_secret: null,
};

function mockDb() {
  const settings = new Map<string, string>();
  const stmt = (sql: string, params: unknown[]) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    first: async <T,>() => (sql.includes('WHERE key = ?') && settings.has(String(params[0])) ? ({ value: settings.get(String(params[0])) } as T) : (null as T)),
    run: async () => {
      if (sql.includes('INTO integration_settings')) settings.set(String(params[0]), String(params[1]));
      return { meta: {} };
    },
  });
  return { settings, db: { prepare: (sql: string) => stmt(sql, []) } as unknown as D1Database };
}

describe('debugAccountToken (B-04)', () => {
  it('maps the debug payload and diffs scopes by connection type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        is_valid: true,
        app_id: '123456',
        expires_at: 1_900_000_000,
        data_access_expires_at: 1_800_000_000,
        scopes: [{ scope: 'instagram_business_basic' }],
      },
    }), { status: 200 })));
    const info = await debugAccountToken({ IG_APP_ID: '123456', IG_APP_SECRET: 'secret' }, baseAccount);
    expect(info.status).toBe('ok');
    expect(info.isValid).toBe(true);
    expect(info.appId).toBe('123456');
    expect(info.expiresAt).toBe(1_900_000_000);
    expect(info.missingScopes).toEqual(expect.arrayContaining(['instagram_business_manage_messages']));
    expect(IG_REQUIRED_SCOPES.instagram_login).toContain('instagram_business_basic');
    vi.unstubAllGlobals();
  });

  it('returns status unknown when Meta is unreachable (not fail)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const info = await debugAccountToken({ IG_APP_ID: '123456', IG_APP_SECRET: 'secret' }, baseAccount);
    expect(info.status).toBe('unknown');
    expect(info.error).toContain('network down');
    vi.unstubAllGlobals();
  });

  it('round-trips through integration_settings', async () => {
    const { db, settings } = mockDb();
    await saveTokenDebug(db, 'acc1', { checkedAt: '2026-11-16T00:00:00Z', status: 'ok', isValid: true, expiresAt: 0 });
    const loaded = await loadTokenDebug(db, 'acc1');
    expect(loaded?.expiresAt).toBe(0);
    expect(settings.get('health:token_debug:acc1')).toBeTruthy();
    expect(await loadTokenDebug(db, 'missing')).toBeNull();
  });

  it('treats expires_at 0 as never-expiring for display', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { is_valid: true, app_id: '1', expires_at: 0, scopes: [] },
    }), { status: 200 })));
    const info = await debugAccountToken({ IG_APP_ID: '1', IG_APP_SECRET: 's' }, baseAccount);
    expect(info.expiresAt).toBe(0);
    vi.unstubAllGlobals();
  });
});
