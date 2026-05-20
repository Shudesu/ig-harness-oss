import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveLineCrossLinkUrl } from '../line-cross-link.js';
import type { EngagementGate } from '@ig-harness/db';

/**
 * Shape-accurate mock for the two tables this service touches: line_harness_connections
 * (read-only) and engagement_gates (UPDATE line_tracked_link_short on first call).
 * Only implements the narrow SQL shapes resolveLineCrossLinkUrl relies on.
 */
function createMockDb(opts: {
  connections?: Array<{ id: string; worker_url: string; api_key: string }>;
  gateCacheById?: Record<string, string | null>;
}) {
  const connections = opts.connections ?? [];
  const gateCache = opts.gateCacheById ?? {};
  const updateLog: Array<{ gateId: string; short: string | null }> = [];

  function makeStatement(sql: string, params: unknown[]) {
    return {
      async first<T>() {
        if (sql.includes('FROM line_harness_connections') && sql.includes('WHERE id = ?')) {
          return (connections.find((c) => c.id === params[0]) as T) ?? null;
        }
        if (
          sql.includes('SELECT line_tracked_link_short') &&
          sql.includes('FROM engagement_gates') &&
          sql.includes('WHERE id = ?')
        ) {
          const gateId = params[0] as string;
          return { line_tracked_link_short: gateCache[gateId] ?? null } as unknown as T;
        }
        return null;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
      async run() {
        if (sql.startsWith('UPDATE engagement_gates') && sql.includes('line_tracked_link_short')) {
          const short = params[0] as string | null;
          const gateId = params[1] as string;
          const isConditional = sql.includes('line_tracked_link_short IS NULL');
          // Honor the "only if still NULL" guard so the race-loser path in
          // resolveLineCrossLinkUrl gets meta.changes === 0 when another
          // delivery has already populated the cache.
          if (isConditional && gateCache[gateId] != null) {
            return { meta: { changes: 0 } };
          }
          gateCache[gateId] = short;
          updateLog.push({ gateId, short });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
  }

  return {
    updateLog,
    gateCache,
    prepare(sql: string) {
      const stmt = makeStatement(sql, []);
      return { ...stmt, bind(...params: unknown[]) { return makeStatement(sql, params); } };
    },
  } as unknown as D1Database & {
    updateLog: typeof updateLog;
    gateCache: typeof gateCache;
  };
}

function makeGate(overrides: Partial<EngagementGate> = {}): EngagementGate {
  return {
    id: 'gate-xyz',
    name: 'test gate',
    status: 'active',
    trigger_type: 'comment_on_post',
    target_post_id: null,
    trigger_keyword: null,
    require_follow: 1,
    initial_dm_text: '',
    initial_dm_button_label: '',
    follow_reminder_dm_text: '',
    follow_reminder_button_label: '',
    reward_dm_text: '',
    reward_url: 'https://line.me/R/ti/p/@example',
    max_loops: 0,
    initial_dm_rich_message_id: null,
    reward_dm_rich_message_id: null,
    follow_reminder_dm_rich_message_id: null,
    comment_reply_text: null,
    followup_dm_sequence: null,
    allow_repeat: 0,
    line_connection_id: null,
    line_pool_slug: null,
    line_tracked_link_short: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolveLineCrossLinkUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when gate has no line_connection_id', async () => {
    const db = createMockDb({});
    const fetchImpl = vi.fn();
    const url = await resolveLineCrossLinkUrl(db, makeGate(), 'IGSID1', { fetchImpl });
    expect(url).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when reward_url is missing even if connection is set', async () => {
    const db = createMockDb({
      connections: [{ id: 'conn-1', worker_url: 'https://lh.example.com', api_key: 'k1' }],
    });
    const fetchImpl = vi.fn();
    const url = await resolveLineCrossLinkUrl(
      db,
      makeGate({ line_connection_id: 'conn-1', reward_url: null }),
      'IGSID1',
      { fetchImpl },
    );
    expect(url).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates a tracked link on first call, caches short, returns /r/<short>?ig=...&pool=...', async () => {
    const db = createMockDb({
      connections: [{ id: 'conn-1', worker_url: 'https://lh.example.com', api_key: 'k1' }],
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://lh.example.com/api/tracked-links');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer k1');
      expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');
      const body = JSON.parse(init!.body as string);
      expect(body.originalUrl).toBe('https://line.me/R/ti/p/@example');
      expect(typeof body.name).toBe('string');
      return new Response(
        JSON.stringify({ success: true, data: { id: 'tl_abc123', trackingUrl: 'https://lh.example.com/t/tl_abc123' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const gate = makeGate({ line_connection_id: 'conn-1', line_pool_slug: 'summer', line_tracked_link_short: null });
    const url = await resolveLineCrossLinkUrl(db, gate, 'IGSID42', { fetchImpl });

    expect(url).toBe('https://lh.example.com/r/tl_abc123?ig=IGSID42&pool=summer');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Cache was persisted
    expect(db.updateLog).toEqual([{ gateId: 'gate-xyz', short: 'tl_abc123' }]);
    // In-memory mutation so the rest of the same invocation sees the cache
    expect(gate.line_tracked_link_short).toBe('tl_abc123');
  });

  it('reuses cached short without hitting LINE Harness on subsequent deliveries', async () => {
    const db = createMockDb({
      connections: [{ id: 'conn-1', worker_url: 'https://lh.example.com', api_key: 'k1' }],
    });
    const fetchImpl = vi.fn();

    const gate = makeGate({
      line_connection_id: 'conn-1',
      line_pool_slug: null,
      line_tracked_link_short: 'tl_cached',
    });
    const url = await resolveLineCrossLinkUrl(db, gate, 'IGSID7', { fetchImpl });

    expect(url).toBe('https://lh.example.com/r/tl_cached?ig=IGSID7');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null and skips cache write when LINE Harness responds non-2xx', async () => {
    const db = createMockDb({
      connections: [{ id: 'conn-1', worker_url: 'https://lh.example.com', api_key: 'k1' }],
    });
    const fetchImpl = vi.fn(async () =>
      new Response('{"success":false,"error":"boom"}', { status: 502 }),
    );

    const url = await resolveLineCrossLinkUrl(
      db,
      makeGate({ line_connection_id: 'conn-1', line_tracked_link_short: null }),
      'IG',
      { fetchImpl },
    );

    expect(url).toBeNull();
    expect(db.updateLog).toEqual([]);
  });

  it('returns null when the gate references a connection that no longer exists', async () => {
    const db = createMockDb({ connections: [] });
    const fetchImpl = vi.fn();
    const url = await resolveLineCrossLinkUrl(
      db,
      makeGate({ line_connection_id: 'conn-deleted' }),
      'IGSID',
      { fetchImpl },
    );
    expect(url).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('url-encodes the IGSID so colons / unusual chars survive', async () => {
    const db = createMockDb({
      connections: [{ id: 'conn-1', worker_url: 'https://lh.example.com', api_key: 'k1' }],
    });
    const gate = makeGate({
      line_connection_id: 'conn-1',
      line_pool_slug: 'main',
      line_tracked_link_short: 'tl_abc',
    });
    const url = await resolveLineCrossLinkUrl(db, gate, 'ig:42/weird&chars', {
      fetchImpl: vi.fn(),
    });
    expect(url).toBe('https://lh.example.com/r/tl_abc?ig=ig%3A42%2Fweird%26chars&pool=main');
  });

  it('race-loser: reuses the winning short when conditional UPDATE meta.changes=0', async () => {
    // Simulate two concurrent deliveries arriving at an uncached gate:
    // recipient A wins the UPDATE, recipient B's conditional UPDATE sees
    // a non-NULL row and must fall back to A's short so both recipients
    // share one tracked link (except for the wasted POST on LINE Harness).
    const db = createMockDb({
      connections: [{ id: 'conn-1', worker_url: 'https://lh.example.com', api_key: 'k1' }],
      // Pre-seed the winner's short. This stands in for "recipient A already
      // completed its UPDATE between B's POST and B's own UPDATE attempt".
      gateCacheById: { 'gate-xyz': 'tl_winner' },
    });
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { id: 'tl_loser' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const gate = makeGate({
      line_connection_id: 'conn-1',
      // Stale in-memory snapshot: the DB row is already set, but this
      // delivery's gate object still has NULL (it read before the winner).
      line_tracked_link_short: null,
    });
    const url = await resolveLineCrossLinkUrl(db, gate, 'IG_B', { fetchImpl });

    expect(url).toBe('https://lh.example.com/r/tl_winner?ig=IG_B');
    // We still POSTed (the race is fundamental to the trigger path) but the
    // conditional UPDATE correctly bailed out, and the loser adopted the
    // winner's short for both the returned URL and the in-memory cache.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.updateLog).toEqual([]);
    expect(gate.line_tracked_link_short).toBe('tl_winner');
  });

  it('strips a trailing slash on worker_url so the join is clean', async () => {
    const db = createMockDb({
      connections: [{ id: 'c', worker_url: 'https://lh.example.com/', api_key: 'k' }],
    });
    const url = await resolveLineCrossLinkUrl(
      db,
      makeGate({ line_connection_id: 'c', line_tracked_link_short: 'tl1' }),
      'IG',
      { fetchImpl: vi.fn() },
    );
    expect(url).toBe('https://lh.example.com/r/tl1?ig=IG');
  });
});
