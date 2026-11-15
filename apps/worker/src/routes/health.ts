import { Hono } from 'hono';
import {
  getAccountHealthLogs,
  getLatestRiskLevel,
  getAccountMigrations,
  getAccountMigrationById,
  createAccountMigration,
  updateAccountMigration,
  listIgAccounts,
  getIgAccountById,
} from '@ig-harness/db';
import { getHealthSnapshot } from '../lib/health.js';
import { runConnectionHealth, loadConnectionHealth, summarizeNextActions, type ConnectionHealthAccount } from '../lib/connection-health.js';
import type { Env } from '../index.js';

const health = new Hono<Env>();

// ========== Aggregate health snapshot ==========

// GET /api/health — returns a point-in-time health snapshot.
// Always returns HTTP 200 even when db_ok=false so monitoring probes always
// get a parseable response. Bearer auth is enforced by the global authMiddleware.
health.get('/api/health', async (c) => {
  const snapshot = await getHealthSnapshot(c.env.DB);
  return c.json({ success: true, data: snapshot });
});

// ========== B-07: connection-health contract ==========

// GET /api/connection-health?account_id= — owner/admin. Same JSON the MCP
// connection_health tool returns. refresh=true re-runs the Graph-backed
// probes right now instead of returning the stored (hourly) result.
health.get('/api/connection-health', async (c) => {
  try {
    const accountId = c.req.query('account_id');
    const refresh = c.req.query('refresh') === 'true';
    const accounts = await listIgAccounts(c.env.DB);
    if (accountId) {
      const account = await getIgAccountById(c.env.DB, accountId);
      if (!account) return c.json({ success: false, error: 'account not found' }, 404);
      const report = refresh
        ? await runConnectionHealth(c.env.DB, c.env, account as unknown as ConnectionHealthAccount, { live: true })
        : (await loadConnectionHealth(c.env.DB, accountId)) ?? (await runConnectionHealth(c.env.DB, c.env, account as unknown as ConnectionHealthAccount));
      return c.json({ success: true, data: report });
    }
    const reports = [];
    for (const account of accounts) {
      reports.push(refresh
        ? await runConnectionHealth(c.env.DB, c.env, account as unknown as ConnectionHealthAccount, { live: true })
        : (await loadConnectionHealth(c.env.DB, account.id)) ?? (await runConnectionHealth(c.env.DB, c.env, account as unknown as ConnectionHealthAccount)));
    }
    return c.json({ success: true, data: { checkedAt: new Date().toISOString(), accounts: reports, nextActions: summarizeNextActions(reports) } });
  } catch (err) {
    console.error('GET /api/connection-health error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== アカウントヘルス ==========

health.get('/api/accounts/:id/health', async (c) => {
  try {
    const igAccountId = c.req.param('id');
    const [riskLevel, logs] = await Promise.all([
      getLatestRiskLevel(c.env.DB, igAccountId),
      getAccountHealthLogs(c.env.DB, igAccountId),
    ]);
    return c.json({
      success: true,
      data: {
        igAccountId,
        lineAccountId: igAccountId, // Deprecated wire alias retained for existing clients.
        riskLevel,
        logs: logs.map((l) => ({
          id: l.id,
          errorCode: l.error_code,
          errorCount: l.error_count,
          checkPeriod: l.check_period,
          riskLevel: l.risk_level,
          createdAt: l.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/accounts/:id/health error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== アカウント移行 ==========

health.get('/api/accounts/migrations', async (c) => {
  try {
    const items = await getAccountMigrations(c.env.DB);
    return c.json({
      success: true,
      data: items.map((m) => ({
        id: m.id,
        fromAccountId: m.from_account_id,
        toAccountId: m.to_account_id,
        status: m.status,
        migratedCount: m.migrated_count,
        totalCount: m.total_count,
        createdAt: m.created_at,
        completedAt: m.completed_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/accounts/migrations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

health.post('/api/accounts/:id/migrate', async (c) => {
  try {
    const fromAccountId = c.req.param('id');
    const body = await c.req.json<{ toAccountId: string }>();
    if (!body.toAccountId) return c.json({ success: false, error: 'toAccountId is required' }, 400);

    const db = c.env.DB;

    // 移行対象: このアカウントに紐づく友だち数をカウント（line_accountsとの関連はuser_id経由）
    // 簡易版: is_following=1 の全友だちを移行対象とする
    const countResult = await db
      .prepare(`SELECT COUNT(*) as count FROM followers`)
      .first<{ count: number }>();
    const totalCount = countResult?.count ?? 0;

    const migration = await createAccountMigration(db, {
      fromAccountId,
      toAccountId: body.toAccountId,
      totalCount,
    });

    // 移行処理は非同期で実行（実際の移行はUUIDベースなのでユーザーが新アカウントを友だち追加した時に自動マッチされる）
    await updateAccountMigration(db, migration.id, {
      status: 'in_progress',
    });

    return c.json({
      success: true,
      data: {
        id: migration.id,
        fromAccountId: migration.from_account_id,
        toAccountId: migration.to_account_id,
        status: 'in_progress',
        totalCount: migration.total_count,
        createdAt: migration.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/accounts/:id/migrate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

health.get('/api/accounts/migrations/:migrationId', async (c) => {
  try {
    const item = await getAccountMigrationById(c.env.DB, c.req.param('migrationId'));
    if (!item) return c.json({ success: false, error: 'Migration not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: item.id,
        fromAccountId: item.from_account_id,
        toAccountId: item.to_account_id,
        status: item.status,
        migratedCount: item.migrated_count,
        totalCount: item.total_count,
        createdAt: item.created_at,
        completedAt: item.completed_at,
      },
    });
  } catch (err) {
    console.error('GET /api/accounts/migrations/:migrationId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { health };
