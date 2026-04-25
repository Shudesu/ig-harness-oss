import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * LINE Harness multi-connection registry. Mirrors the X Harness pattern:
 * one row per LINE Harness deployment the operator wants to reach
 * (本番 / テスト / 別アカウントの LINE Harness …). Campaigns reference a
 * connection by id; LINE-side concepts (tracked links, pools, forms)
 * live on LINE Harness and are fetched through a proxy on this worker.
 */

interface LineConnection {
  id: string;
  name: string;
  worker_url: string;
  api_key: string;
  account_id: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const connections = new Hono<Env>();

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

function publicShape(c: LineConnection) {
  return {
    id: c.id,
    name: c.name,
    worker_url: c.worker_url,
    api_key_masked: maskKey(c.api_key),
    account_id: c.account_id,
    is_default: c.is_default === 1,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

async function fetchConnection(db: D1Database, id: string): Promise<LineConnection | null> {
  return db
    .prepare('SELECT * FROM line_harness_connections WHERE id = ?')
    .bind(id)
    .first<LineConnection>();
}

async function resolveConnectionForLookup(db: D1Database, id: string | null): Promise<LineConnection | null> {
  if (id) return fetchConnection(db, id);
  // Fall back to default / first row.
  return db
    .prepare(
      `SELECT * FROM line_harness_connections
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
    )
    .first<LineConnection>();
}

// ── CRUD ────────────────────────────────────────────────────────

connections.get('/api/line-connections', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT * FROM line_harness_connections ORDER BY is_default DESC, created_at ASC')
    .all<LineConnection>();
  return c.json({ success: true, data: rows.results.map(publicShape) });
});

connections.post('/api/line-connections', async (c) => {
  const body = await c.req.json<{
    name?: string;
    worker_url?: string;
    api_key?: string;
    account_id?: string | null;
    is_default?: boolean;
  }>();
  if (!body.name || !body.worker_url || !body.api_key) {
    return c.json({ success: false, error: 'name / worker_url / api_key required' }, 400);
  }
  const id = crypto.randomUUID();

  // First connection becomes default automatically; if is_default=true is
  // explicitly requested we demote any other default row.
  const existingCount = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM line_harness_connections')
    .first<{ n: number }>();
  const shouldBeDefault = (existingCount?.n ?? 0) === 0 || body.is_default === true;
  if (body.is_default === true) {
    await c.env.DB.prepare('UPDATE line_harness_connections SET is_default = 0').run();
  }

  await c.env.DB
    .prepare(
      `INSERT INTO line_harness_connections
       (id, name, worker_url, api_key, account_id, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      body.name,
      body.worker_url.replace(/\/$/, ''),
      body.api_key,
      body.account_id ?? null,
      shouldBeDefault ? 1 : 0,
    )
    .run();
  const row = await fetchConnection(c.env.DB, id);
  if (!row) return c.json({ success: false, error: 'insert failed' }, 500);
  return c.json({ success: true, data: publicShape(row) });
});

/**
 * In-place update: rotate `api_key`, fix a `worker_url` typo, rename, etc.
 * The id stays stable, so existing engagement_gates with this connection
 * keep working without a manual re-bind. Only fields present in the
 * payload are written; omit a field to keep the existing value.
 */
connections.patch('/api/line-connections/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await fetchConnection(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: 'not found' }, 404);
  const body = await c.req.json<{
    name?: string;
    worker_url?: string;
    api_key?: string;
    account_id?: string | null;
    is_default?: boolean;
  }>();

  const sets: string[] = [];
  const binds: unknown[] = [];
  let newWorkerUrl: string | null = null;
  if (typeof body.name === 'string') {
    if (body.name.trim().length === 0) {
      return c.json({ success: false, error: 'name cannot be empty' }, 400);
    }
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (typeof body.worker_url === 'string') {
    // Empty-string check matches the POST path's "required" semantics —
    // an operator who clears the field via PATCH would otherwise poison
    // the row and break every gate referencing this connection.
    if (body.worker_url.trim().length === 0) {
      return c.json({ success: false, error: 'worker_url cannot be empty' }, 400);
    }
    const normalized = body.worker_url.replace(/\/$/, '');
    sets.push('worker_url = ?');
    binds.push(normalized);
    if (normalized !== existing.worker_url) newWorkerUrl = normalized;
  }
  if (typeof body.api_key === 'string') {
    if (body.api_key.length === 0) {
      return c.json({ success: false, error: 'api_key cannot be empty' }, 400);
    }
    sets.push('api_key = ?');
    binds.push(body.api_key);
  }
  if ('account_id' in body) {
    sets.push('account_id = ?');
    binds.push(body.account_id ?? null);
  }
  if (sets.length === 0 && body.is_default !== true) {
    return c.json({ success: false, error: 'no fields to update' }, 400);
  }

  if (sets.length > 0) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now'))");
    await c.env.DB
      .prepare(`UPDATE line_harness_connections SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }

  // Worker URL changed → every gate that has already cached a tracked
  // link short for this connection now points at a different LINE
  // Harness deployment. The cached short id won't resolve over there
  // (or worse, resolves to an unrelated link), so we invalidate the
  // cache so the next delivery regenerates it on the new worker.
  //
  // Plus: gates created in "auto" mode (no manual reward URL) had
  // `${oldWorker}/auth/line` baked into reward_url by the wizard. The
  // tracked-link `originalUrl` carries that stale host, so even after
  // we recreate the tracked link on the new worker, recipients clicking
  // through `/r/<short>` still get redirected to the old deployment.
  // Rewrite those auto-defaults in lock-step with the worker_url change;
  // gates with a custom reward_url (operator-typed LP / external link)
  // are left alone — that's their explicit choice.
  if (newWorkerUrl) {
    const oldDefault = `${existing.worker_url.replace(/\/$/, '')}/auth/line`;
    const newDefault = `${newWorkerUrl}/auth/line`;
    await c.env.DB
      .prepare(
        `UPDATE engagement_gates
         SET line_tracked_link_short = NULL,
             reward_url = CASE WHEN reward_url = ? THEN ? ELSE reward_url END
         WHERE line_connection_id = ?`,
      )
      .bind(oldDefault, newDefault, id)
      .run();
  }

  // Promotion to default is mutually exclusive across rows, so it lives
  // on a separate UPDATE pair (demote others first, then promote this).
  if (body.is_default === true) {
    await c.env.DB.prepare('UPDATE line_harness_connections SET is_default = 0').run();
    await c.env.DB
      .prepare('UPDATE line_harness_connections SET is_default = 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  const row = await fetchConnection(c.env.DB, id);
  if (!row) return c.json({ success: false, error: 'update failed' }, 500);
  return c.json({ success: true, data: publicShape(row) });
});

connections.delete('/api/line-connections/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await fetchConnection(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: 'not found' }, 404);
  await c.env.DB.prepare('DELETE FROM line_harness_connections WHERE id = ?').bind(id).run();
  // If we removed the default, promote the oldest remaining row.
  if (existing.is_default === 1) {
    await c.env.DB
      .prepare(
        `UPDATE line_harness_connections SET is_default = 1
         WHERE id = (SELECT id FROM line_harness_connections ORDER BY created_at ASC LIMIT 1)`,
      )
      .run();
  }
  return c.json({ success: true });
});

connections.post('/api/line-connections/:id/set-default', async (c) => {
  const id = c.req.param('id');
  const existing = await fetchConnection(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: 'not found' }, 404);
  await c.env.DB.prepare('UPDATE line_harness_connections SET is_default = 0').run();
  await c.env.DB
    .prepare('UPDATE line_harness_connections SET is_default = 1 WHERE id = ?')
    .bind(id)
    .run();
  return c.json({ success: true });
});

// ── Proxy helpers ───────────────────────────────────────────────

async function lhFetch(
  conn: LineConnection,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  // Pool is the intended delegation for multi-tenant attribution; the
  // API key alone tells LINE Harness which account context it's in, so
  // we deliberately don't forward X-LINE-ACCOUNT-ID here.
  const base = conn.worker_url.replace(/\/$/, '');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${conn.api_key}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

// ── Test ────────────────────────────────────────────────────────

connections.post('/api/line-connections/:id/test', async (c) => {
  const conn = await fetchConnection(c.env.DB, c.req.param('id'));
  if (!conn) return c.json({ success: false, error: 'not found' }, 404);
  try {
    const res = await lhFetch(conn, '/api/friends?limit=1');
    if (res.status === 401) return c.json({ success: false, error: 'API Key が無効です (401)' }, 401);
    if (!res.ok) {
      const text = await res.text();
      return c.json({ success: false, error: `LINE Harness: ${res.status} ${text.slice(0, 120)}` }, 502);
    }
    return c.json({ success: true, data: { message: '疎通OK' } });
  } catch (err) {
    return c.json(
      { success: false, error: `接続エラー: ${err instanceof Error ? err.message : String(err)}` },
      502,
    );
  }
});

// ── Tracked-links proxy (per connection) ────────────────────────

connections.get('/api/line-connections/:id/tracked-links', async (c) => {
  const conn = await resolveConnectionForLookup(c.env.DB, c.req.param('id'));
  if (!conn) return c.json({ success: false, error: '接続先が未登録です' }, 400);
  const res = await lhFetch(conn, '/api/tracked-links');
  if (!res.ok) return c.json({ success: false, error: `LINE Harness: ${res.status}` }, 502);
  return c.json(await res.json());
});

connections.post('/api/line-connections/:id/tracked-links', async (c) => {
  const conn = await resolveConnectionForLookup(c.env.DB, c.req.param('id'));
  if (!conn) return c.json({ success: false, error: '接続先が未登録です' }, 400);
  const body = await c.req.json();
  const res = await lhFetch(conn, '/api/tracked-links', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ success: false, error: `LINE Harness: ${res.status}` }, 502);
  return c.json(await res.json());
});

// ── Traffic pools proxy (per connection) ────────────────────────

connections.get('/api/line-connections/:id/traffic-pools', async (c) => {
  const conn = await resolveConnectionForLookup(c.env.DB, c.req.param('id'));
  if (!conn) return c.json({ success: false, error: '接続先が未登録です' }, 400);
  const res = await lhFetch(conn, '/api/traffic-pools');
  if (!res.ok) {
    // LINE Harness might not expose /api/traffic-pools on older builds —
    // treat 404 as "pools feature unavailable" rather than an error.
    if (res.status === 404) return c.json({ success: true, data: [] });
    return c.json({ success: false, error: `LINE Harness: ${res.status}` }, 502);
  }
  return c.json(await res.json());
});

export { connections as lineConnections };
