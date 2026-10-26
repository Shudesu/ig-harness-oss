import { it, expect } from 'vitest';
import { triggerGateForComment } from '../engagement-gate.js';
import { processCommentRuleJobs } from '../comment-rule-jobs.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
it('queues one private CTA, logs it only after sending, and waits for a reply', async () => {
    const f = await gateFixture();
    try {
        f.addGate();
        await triggerGateForComment(f.db, f.client as any, f.args);
        await triggerGateForComment(f.db, f.client as any, f.args);
        expect(f.client.sendGenericTemplate).not.toHaveBeenCalled();
        expect(f.sqlite.prepare('SELECT COUNT(*) n FROM comment_rule_jobs').get()?.n).toBe(1);
        expect(f.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()?.n).toBe(0);
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        expect(f.client.sendPrivateReply).toHaveBeenCalledOnce();
        expect(f.client.sendPrivateReply.mock.calls[0]?.[0]).toBe('comment-1');
        expect(f.sqlite.prepare('SELECT trigger_source FROM messages_log').get()?.trigger_source).toBe('gate');
        expect(JSON.parse(String(f.sqlite.prepare('SELECT metadata FROM gate_deliveries').get()?.metadata)).awaiting_reply).toBe(1);
    }
    finally {
        f.sqlite.close();
    }
});
it('does not enqueue a gate whose keyword does not match', async () => {
    const f = await gateFixture();
    try {
        f.addGate('g', { trigger_keyword: 'other' });
        expect(await triggerGateForComment(f.db, f.client as any, f.args)).toBe(false);
        expect(f.sqlite.prepare('SELECT COUNT(*) n FROM comment_rule_jobs').get()?.n).toBe(0);
    }
    finally {
        f.sqlite.close();
    }
});
it('does not send again when this follower already completed the gate', async () => {
    const f = await gateFixture();
    try {
        f.addGate();
        f.sqlite.exec("INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status) VALUES('d','g',1,'user-1','delivered')");
        await triggerGateForComment(f.db, f.client as any, f.args);
        expect(f.sqlite.prepare('SELECT COUNT(*) n FROM comment_rule_jobs').get()?.n).toBe(0);
    }
    finally {
        f.sqlite.close();
    }
});
it('prefers a post-scoped gate over an all-post fallback', async () => {
    const f = await gateFixture();
    try {
        f.addGate('global');
        f.addGate('specific', { target_post_id: 'post-1' });
        await triggerGateForComment(f.db, f.client as any, f.args);
        expect(f.sqlite.prepare('SELECT gate_id FROM gate_deliveries').get()?.gate_id).toBe('specific');
    }
    finally {
        f.sqlite.close();
    }
});
it('records a public reply failure without retrying the private message', async () => {
    const f = await gateFixture();
    try {
        f.addGate('g', { comment_reply_text: '@{{username}} Please check your DM' });
        f.client.postCommentToMedia.mockRejectedValue(new Error('permission'));
        await triggerGateForComment(f.db, f.client as any, f.args);
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        expect(f.client.sendPrivateReply).toHaveBeenCalledOnce();
        expect(f.sqlite.prepare('SELECT reason FROM comment_rule_jobs').get()?.reason).toBe('public_reply_failed');
    }
    finally {
        f.sqlite.close();
    }
});
