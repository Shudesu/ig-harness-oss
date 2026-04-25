import { Hono } from 'hono';
import type { Env } from '../index.js';

const integrations = new Hono<Env>();

/** Simple key-value config persisted in D1. */
async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM integration_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(db: D1Database, key: string, value: string | null): Promise<void> {
  if (value === null || value === '') {
    await db.prepare('DELETE FROM integration_settings WHERE key = ?').bind(key).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO integration_settings (key, value, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now')))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value)
    .run();
}

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return '••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

async function getLineHarnessConfig(db: D1Database) {
  const [url, apiKey, accountId] = await Promise.all([
    getSetting(db, 'line_harness_url'),
    getSetting(db, 'line_harness_api_key'),
    getSetting(db, 'line_harness_account_id'),
  ]);
  return { url, apiKey, accountId };
}

// ── Config ─────────────────────────────────────────────────────

integrations.get('/api/integrations/line-harness/config', async (c) => {
  const cfg = await getLineHarnessConfig(c.env.DB);
  return c.json({
    success: true,
    data: {
      url: cfg.url,
      api_key_masked: maskKey(cfg.apiKey),
      has_api_key: !!cfg.apiKey,
      account_id: cfg.accountId,
    },
  });
});

integrations.post('/api/integrations/line-harness/config', async (c) => {
  const body = await c.req.json<{
    url?: string | null;
    api_key?: string | null;
    account_id?: string | null;
  }>();
  // Treat undefined as "no change", null/empty as "clear".
  if (body.url !== undefined) await setSetting(c.env.DB, 'line_harness_url', body.url ?? '');
  if (body.api_key !== undefined && body.api_key !== null) {
    // Sentinel: client sends the masked string to mean "don't change".
    if (!body.api_key.includes('••••')) {
      await setSetting(c.env.DB, 'line_harness_api_key', body.api_key);
    }
  } else if (body.api_key === null) {
    await setSetting(c.env.DB, 'line_harness_api_key', '');
  }
  if (body.account_id !== undefined)
    await setSetting(c.env.DB, 'line_harness_account_id', body.account_id ?? '');
  return c.json({ success: true });
});

// ── Connection test + proxy ─────────────────────────────────────

async function lineHarnessFetch(
  db: D1Database,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const cfg = await getLineHarnessConfig(db);
  if (!cfg.url || !cfg.apiKey) {
    return new Response(
      JSON.stringify({ success: false, error: 'LINE Harness が未設定です' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const base = cfg.url.replace(/\/$/, '');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${cfg.apiKey}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (cfg.accountId && !headers.has('X-LINE-ACCOUNT-ID')) {
    headers.set('X-LINE-ACCOUNT-ID', cfg.accountId);
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

integrations.get('/api/integrations/line-harness/test', async (c) => {
  try {
    // LINE Harness exposes /api/friends which any authed account can hit.
    const res = await lineHarnessFetch(c.env.DB, '/api/friends?limit=1');
    if (res.status === 400) {
      // Our own "未設定" bubble from lineHarnessFetch.
      return c.json(await res.json(), 400);
    }
    if (res.status === 401) {
      return c.json({ success: false, error: 'API Key が無効です (401)' }, 401);
    }
    if (!res.ok) {
      const text = await res.text();
      return c.json({ success: false, error: `LINE Harness: ${res.status} ${text.slice(0, 120)}` }, 500);
    }
    return c.json({ success: true, data: { message: '疎通OK' } });
  } catch (err) {
    return c.json(
      { success: false, error: `接続エラー: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }
});

// ── Tracked-links proxy ─────────────────────────────────────────

integrations.get('/api/integrations/line-harness/tracked-links', async (c) => {
  const res = await lineHarnessFetch(c.env.DB, '/api/tracked-links');
  if (!res.ok) {
    return c.json(
      { success: false, error: `LINE Harness: ${res.status}` },
      res.status === 400 ? 400 : 502,
    );
  }
  const json = await res.json();
  return c.json(json);
});

integrations.post('/api/integrations/line-harness/tracked-links', async (c) => {
  const body = await c.req.json();
  const res = await lineHarnessFetch(c.env.DB, '/api/tracked-links', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return c.json(
      { success: false, error: `LINE Harness: ${res.status}` },
      res.status === 400 ? 400 : 502,
    );
  }
  const json = await res.json();
  return c.json(json);
});

export { integrations };
