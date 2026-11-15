import { InstagramApiError } from '@ig-harness/ig-sdk';
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
        f.client.replyToComment.mockRejectedValue(new InstagramApiError('(#10) Application does not have permission for this action', 400, 10));
        await triggerGateForComment(f.db, f.client as any, f.args);
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        expect(f.client.sendPrivateReply).toHaveBeenCalledOnce();
        expect(f.client.replyToComment).toHaveBeenCalledOnce();
        expect(f.sqlite.prepare('SELECT status,public_reply_status,public_reply_error_code,public_reply_error_message FROM comment_rule_jobs').get()).toMatchObject({ status: 'sent', public_reply_status: 'failed', public_reply_error_code: 10, public_reply_error_message: expect.stringContaining('permission') });
        expect(f.sqlite.prepare('SELECT source,error_code,follower_id FROM delivery_failures').all()).toEqual([{ source: 'public_reply', error_code: 10, follower_id: 1 }]);
    }
    finally {
        f.sqlite.close();
    }
});

it('posts the gate public reply as a thread reply via /{comment-id}/replies by default', async () => {
    const f = await gateFixture();
    try {
        f.addGate('g', { comment_reply_text: 'DMを送りました' });
        await triggerGateForComment(f.db, f.client as any, f.args);
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        expect(f.client.replyToComment).toHaveBeenCalledWith('comment-1', 'DMを送りました');
        expect(f.client.postCommentToMedia).not.toHaveBeenCalled();
        expect(f.sqlite.prepare('SELECT public_reply_status,public_reply_id FROM comment_rule_jobs').get()).toMatchObject({ public_reply_status: 'sent', public_reply_id: 'nested' });
    }
    finally {
        f.sqlite.close();
    }
});
it('keeps the @username top-level comment when the gate selects mention mode', async () => {
    const f = await gateFixture();
    try {
        f.addGate('g', { comment_reply_text: '@{{username}} DMを見てね', comment_reply_mode: 'mention' });
        await triggerGateForComment(f.db, f.client as any, f.args);
        await processCommentRuleJobs(f.db, f.client as any, 'a');
        expect(f.client.postCommentToMedia).toHaveBeenCalledWith('post-1', '@person DMを見てね');
        expect(f.client.replyToComment).not.toHaveBeenCalled();
    }
    finally {
        f.sqlite.close();
    }
});
