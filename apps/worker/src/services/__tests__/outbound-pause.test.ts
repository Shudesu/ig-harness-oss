import { afterEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import { setOutboundPaused } from '../human-touch.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
    for (const db of databases.splice(0)) db.close();
});

/** Stop switch keeps every batch sender idle; work resumes after unpausing. */
describe('outbound stop switch (U22) — batch processors', () => {
    it('holds broadcasts while paused and resumes them after unpausing', async () => {
        const { sqlite, db } = await testDatabase();
        databases.push(sqlite);
        sqlite.exec(`INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01');
        INSERT INTO broadcasts(id,name,message_type,body,account_id) VALUES(1,'Test','text','{"text":"hello"}','a')`);
        sqlite.prepare('INSERT INTO followers(id,igsid,account_id,last_inbound_at) VALUES(1,?,?,?)').run('u1', 'a', new Date().toISOString());
        const client = { sendText: vi.fn(async () => ({ message_id: 'm' })) };
        await setOutboundPaused(db, true);
        const { processBroadcastSend } = await import('../broadcast.js');
        await processBroadcastSend(db, client as any, 1, undefined, 'a');
        expect(client.sendText).not.toHaveBeenCalled();
        expect(sqlite.prepare('SELECT status FROM broadcasts').get()).toMatchObject({ status: 'draft' });

        await setOutboundPaused(db, false);
        await processBroadcastSend(db, client as any, 1, undefined, 'a');
        expect(client.sendText).toHaveBeenCalledOnce();
    });

    it('holds comment-rule jobs while paused and resumes them after unpausing', async () => {
        const { sqlite, db } = await testDatabase();
        databases.push(sqlite);
        sqlite.exec(`INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01');
        INSERT INTO followers(id,igsid,account_id) VALUES(1,'u1','a')`);
        sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
        const { enqueueCommentRuleJob } = await import('../comment-rule-jobs.js');
        await enqueueCommentRuleJob(db, { accountId: 'a', ruleId: 'r1', commentId: 'c1', followerId: 1, messageType: 'text', body: '{"text":"hi"}', replyText: null, delaySeconds: 0 });
        const client = {
            sendPrivateReply: vi.fn(async () => ({ message_id: 'm' })),
            getCommentTimestamp: vi.fn(async () => new Date(Date.now() - 1000).toISOString()),
        };
        await setOutboundPaused(db, true);
        const { processCommentRuleJobs } = await import('../comment-rule-jobs.js');
        await processCommentRuleJobs(db, client as any, 'a');
        expect(client.sendPrivateReply).not.toHaveBeenCalled();
        expect(sqlite.prepare('SELECT status FROM comment_rule_jobs').get()).toMatchObject({ status: 'pending' });

        await setOutboundPaused(db, false);
        await processCommentRuleJobs(db, client as any, 'a');
        expect(client.sendPrivateReply).toHaveBeenCalledOnce();
    });

    it('holds scenario steps while paused and resumes them after unpausing', async () => {
        // Freeze inside the 9-23 JST delivery window so the resume send runs.
        vi.useFakeTimers();
        vi.setSystemTime(new Date(Date.UTC(2026, 10, 15, 3, 0, 0))); // 12:00 JST
        const { sqlite, db } = await testDatabase();
        databases.push(sqlite);
        const due = new Date().toISOString();
        sqlite.exec(`INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01');
        INSERT INTO followers(id,igsid,account_id) VALUES(1,'u1','a')`);
        sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(due);
        sqlite.exec(`INSERT INTO scenarios(id,name,trigger_type,account_id) VALUES(1,'Test','manual','a');
        INSERT INTO scenario_steps(scenario_id,step_order,delay_minutes,message_type,body) VALUES(1,1,0,'text','{"text":"One step"}')`);
        sqlite.prepare('INSERT INTO follower_scenarios(id,follower_id,scenario_id,next_step_at) VALUES(1,1,1,?)').run(due);
        const client = { sendText: vi.fn(async () => ({ message_id: 'm' })) };
        await setOutboundPaused(db, true);
        const { processStepDeliveries } = await import('../step-delivery.js');
        await processStepDeliveries(db, client as any, undefined, 'a');
        expect(client.sendText).not.toHaveBeenCalled();
        expect(sqlite.prepare('SELECT status,next_step_at FROM follower_scenarios').get()).toMatchObject({ status: 'active' });

        await setOutboundPaused(db, false);
        await processStepDeliveries(db, client as any, undefined, 'a');
        expect(client.sendText).toHaveBeenCalledOnce();
        vi.useRealTimers();
    });

    it('holds webhook drains while paused and resumes them after unpausing', async () => {
        const { sqlite, db } = await testDatabase();
        databases.push(sqlite);
        sqlite.exec(`INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('a','111','test',1,'2026-01-01','2026-01-01');
        INSERT INTO followers(id,igsid,account_id,last_inbound_at) VALUES(1,'u1','a','2020-01-01')`);
        const { queueWebhookEvents } = await import('../webhook-queue.js');
        await queueWebhookEvents(db, 'a', [{ kind: 'messaging', value: { sender: { id: 'u1' }, message: { mid: 'mid-1', text: 'hello' } } }]);
        const client = { sendText: vi.fn(async () => ({ message_id: 'm' })), getUserProfile: vi.fn(async () => ({ username: 'u1' })) };
        await setOutboundPaused(db, true);
        const { processQueuedWebhooks } = await import('../../routes/webhook.js');
        const account = sqlite.prepare("SELECT * FROM ig_accounts WHERE id='a'").get();
        await processQueuedWebhooks(db, client as any, account as any);
        expect(sqlite.prepare('SELECT status FROM webhook_events').get()).toMatchObject({ status: 'pending' });

        await setOutboundPaused(db, false);
        await processQueuedWebhooks(db, client as any, account as any);
        expect(sqlite.prepare('SELECT status FROM webhook_events').get()).toMatchObject({ status: 'completed' });
    });
});
