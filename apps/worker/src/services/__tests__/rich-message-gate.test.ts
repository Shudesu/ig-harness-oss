import { it, expect } from 'vitest';
import { triggerGateForComment, resumeCommentGate, handleFollowCheckPostback } from '../engagement-gate.js';
import { processCommentRuleJobs } from '../comment-rule-jobs.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
it('holds the configured rich CTA until the commenter replies', async () => {
    const f = await gateFixture();
    try {
        f.sqlite.exec(`INSERT INTO rich_messages(id,name,kind,blocks,account_id) VALUES('rm','Rich','cta','[{"type":"text","text":"Full original content"},{"type":"image","url":"https://example.com/image.jpg"}]','a')`);
        f.addGate('g', { initial_dm_rich_message_id: 'rm' });
        await triggerGateForComment(f.db, f.client as any, f.args);
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        expect(f.client.sendRichMessage).not.toHaveBeenCalled();
        expect(await resumeCommentGate(f.db, f.client as any, f.args.follower, 'a')).toBe(false);
        f.sqlite.prepare('UPDATE followers SET last_inbound_at=? WHERE id=1').run(new Date().toISOString());
        expect(await resumeCommentGate(f.db, f.client as any, f.args.follower, 'a')).toBe(true);
        await resumeCommentGate(f.db, f.client as any, f.args.follower, 'a');
        expect(f.client.sendRichMessage).toHaveBeenCalledOnce();
        expect((f.client.sendRichMessage.mock.calls[0]?.[1] as any[])).toHaveLength(2);
    }
    finally {
        f.sqlite.close();
    }
});
it('uses the normal CTA fallback only after an inbound reply', async () => {
    const f = await gateFixture();
    try {
        f.addGate('g', { initial_dm_rich_message_id: 'missing' });
        await triggerGateForComment(f.db, f.client as any, f.args);
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
        await resumeCommentGate(f.db, f.client as any, f.args.follower, 'a');
        expect(f.client.sendGenericTemplate).toHaveBeenCalledOnce();
    }
    finally {
        f.sqlite.close();
    }
});
it('delivers a rich reward only to the matching recipient inside their inbound window', async () => {
    const f = await gateFixture();
    try {
        f.sqlite.exec(`INSERT INTO rich_messages(id,name,kind,blocks,account_id) VALUES('rm','Reward','reward','[{"type":"text","text":"Reward"}]','a')`);
        f.addGate('g', { reward_dm_rich_message_id: 'rm' });
        f.sqlite.exec("INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status) VALUES('d','g',1,'user-1','cta_sent')");
        f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
        await handleFollowCheckPostback(f.db, f.client as any, { gateId: 'g', deliveryId: 'd', igsid: 'other' });
        expect(f.client.sendRichMessage).not.toHaveBeenCalled();
        await handleFollowCheckPostback(f.db, f.client as any, { gateId: 'g', deliveryId: 'd', igsid: 'user-1' });
        expect(f.client.sendRichMessage).toHaveBeenCalledOnce();
    }
    finally {
        f.sqlite.close();
    }
});
