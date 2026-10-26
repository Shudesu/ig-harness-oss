import { Hono } from 'hono';
import type { Env } from '../index.js';
import { resolveAccount } from '../lib/accounts.js';
import { getHealthSnapshot } from '../lib/health.js';
import { graphApiVersion } from '@ig-harness/ig-sdk';
export const deliveryStatus = new Hono<Env>();
deliveryStatus.get('/api/delivery-status', async (c) => {
    const account = await resolveAccount(c);
    if (!account)
        return c.json({ success: false, error: 'account not found' }, 404);
    const [broadcasts, comments, steps, gates, health] = await Promise.all([
        c.env.DB.prepare(`SELECT CAST(b.id AS TEXT) id,b.name,b.status,COUNT(r.follower_id) total,
      COALESCE(SUM(r.status='sent'),0) sent,COALESCE(SUM(r.status='skipped'),0) skipped,
      COALESCE(SUM(r.status IN ('pending','processing')),0) pending,COALESCE(SUM(r.status IN ('failed','uncertain')),0) attention
      FROM broadcasts b LEFT JOIN broadcast_recipients r ON r.broadcast_id=b.id WHERE b.account_id=? GROUP BY b.id ORDER BY b.created_at DESC LIMIT 10`).bind(account.id).all(),
        c.env.DB.prepare(`SELECT 'comment' kind,j.id,COALESCE(f.username,'コメントDM') name,j.status,j.reason,j.error_code errorCode
      FROM comment_rule_jobs j JOIN followers f ON f.id=j.follower_id WHERE j.account_id=? ORDER BY j.rowid DESC LIMIT 15`).bind(account.id).all(),
        c.env.DB.prepare(`SELECT 'scenario' kind,CAST(fs.id AS TEXT) id,s.name,fs.status,fs.end_reason reason,NULL errorCode
      FROM follower_scenarios fs JOIN scenarios s ON s.id=fs.scenario_id WHERE s.account_id=? AND fs.end_reason IS NOT NULL ORDER BY fs.id DESC LIMIT 10`).bind(account.id).all(),
        c.env.DB.prepare(`SELECT 'gate' kind,d.id,g.name,d.status,d.end_reason reason,NULL errorCode
      FROM gate_deliveries d JOIN engagement_gates g ON g.id=d.gate_id WHERE g.account_id=? AND d.end_reason IS NOT NULL ORDER BY d.triggered_at DESC LIMIT 10`).bind(account.id).all(),
        getHealthSnapshot(c.env.DB),
    ]);
    return c.json({ success: true, data: { graphApiVersion: graphApiVersion(c.env.IG_GRAPH_API_VERSION), account: health.accounts.find(a => a.account_id === account.id) ?? null, broadcasts: broadcasts.results, deliveries: [...comments.results, ...steps.results, ...gates.results] } });
});
