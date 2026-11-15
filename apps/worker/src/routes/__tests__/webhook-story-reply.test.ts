import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMessagingEvent } from '../webhook.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
import { setOutboundPaused } from '../../services/human-touch.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
    for (const db of databases.splice(0)) db.close();
    vi.unstubAllGlobals();
});

const messagingEvent = (extra: Record<string, unknown>) => ({
    sender: { id: 'user-1' },
    recipient: { id: '111' },
    timestamp: Date.now(),
    message: { mid: 'mid-1', text: 'reference', ...extra },
});

describe('story reply auto-DM (U1 / GAP#8)', () => {
    it('detects reply_to.story, forwards a story_reply mileage event and triggers a dm_keyword gate', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        f.addGate('g', { trigger_type: 'dm_keyword', trigger_keyword: 'reference' });
        // Link the follower to LINE so the mileage forward has somewhere to go.
        f.sqlite.exec("UPDATE followers SET line_friend_uuid='lf-1'");
        f.sqlite.exec("INSERT INTO line_harness_connections(id,name,worker_url,api_key,is_default,created_at,updated_at) VALUES('lh','LINE','https://line.example.com','key',1,'2026-01-01','2026-01-01')");
        const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchImpl);

        await handleMessagingEvent(f.db, f.client as any, messagingEvent({ reply_to: { story: { id: 'story-1', url: 'https://instagram.com/stories/story-1' } } }), undefined, undefined, 'a');

        // Gate CTA went out
        expect(f.client.sendGenericTemplate).toHaveBeenCalledOnce();
        expect(f.client.sendGenericTemplate.mock.calls[0]![0]).toBe('user-1');
        // Inbound message logged with the story-reply kind marker
        const logged = f.sqlite.prepare("SELECT message_type, body FROM messages_log WHERE direction='in' ORDER BY id DESC LIMIT 1").get() as { message_type: string; body: string };
        expect(logged.message_type).toBe('text');
        expect(JSON.parse(logged.body)).toMatchObject({ kind: 'story_reply', text: 'reference', story: { id: 'story-1' } });
        // Mileage forward: the reply is both a DM received and a story reply
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const storyCall = fetchImpl.mock.calls.find(([, init]) => JSON.parse((init as RequestInit).body as string).eventType === 'instagram_story_replied')!;
        expect(String(storyCall[0])).toBe('https://line.example.com/api/integrations/ig-harness/engagement');
        expect(JSON.parse((storyCall[1] as RequestInit).body as string)).toMatchObject({ friendId: 'lf-1', eventType: 'instagram_story_replied', sourceEventId: 'a:story:mid-1' });
    });

    it('does nothing when no gate matches the reply text', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        f.addGate('g', { trigger_type: 'dm_keyword', trigger_keyword: 'other' });
        await handleMessagingEvent(f.db, f.client as any, messagingEvent({ reply_to: { story: { id: 'story-1' } } }), undefined, undefined, 'a');
        expect(f.client.sendGenericTemplate).not.toHaveBeenCalled();
        expect(f.client.sendText).not.toHaveBeenCalled();
        const logged = f.sqlite.prepare("SELECT body FROM messages_log WHERE direction='in' ORDER BY id DESC LIMIT 1").get() as { body: string };
        expect(JSON.parse(logged.body)).toMatchObject({ kind: 'story_reply' });
    });

    it('logs and forwards an attachment-only story reply (no text)', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        f.sqlite.exec("UPDATE followers SET line_friend_uuid='lf-1'");
        f.sqlite.exec("INSERT INTO line_harness_connections(id,name,worker_url,api_key,is_default,created_at,updated_at) VALUES('lh','LINE','https://line.example.com','key',1,'2026-01-01','2026-01-01')");
        const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchImpl);
        await handleMessagingEvent(f.db, f.client as any, {
            sender: { id: 'user-1' },
            recipient: { id: '111' },
            timestamp: Date.now(),
            message: { mid: 'mid-1', reply_to: { story: { id: 'story-2' } }, attachments: [{ type: 'image', payload: { url: 'https://example.com/x.png' } }] },
        }, undefined, undefined, 'a');
        // no keyword to branch — and no sends
        expect(f.client.sendGenericTemplate).not.toHaveBeenCalled();
        const logged = f.sqlite.prepare("SELECT message_type, body FROM messages_log WHERE direction='in' ORDER BY id DESC LIMIT 1").get() as { message_type: string; body: string };
        expect(JSON.parse(logged.body)).toMatchObject({ kind: 'story_reply', story: { id: 'story-2' } });
        expect(fetchImpl.mock.calls.some(([, init]) => JSON.parse((init as RequestInit).body as string).eventType === 'instagram_story_replied')).toBe(true);
    });
});

describe('quick reply payload branching (U13 / GAP#1b)', () => {
    it('branches on quick_reply.payload through a dm_keyword gate', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        f.addGate('g', { trigger_type: 'dm_keyword', trigger_keyword: 'plan_a' });
        await handleMessagingEvent(f.db, f.client as any, messagingEvent({ text: 'プランA', quick_reply: { payload: 'plan_a' } }), undefined, undefined, 'a');
        expect(f.client.sendGenericTemplate).toHaveBeenCalledOnce();
        const logged = f.sqlite.prepare("SELECT message_type, body FROM messages_log WHERE direction='in' ORDER BY id DESC LIMIT 1").get() as { message_type: string; body: string };
        expect(logged.message_type).toBe('quick_reply');
        expect(JSON.parse(logged.body)).toMatchObject({ text: 'プランA', payload: 'plan_a' });
    });

    it('routes the payload into a dm_keyword scenario when no gate matches', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        f.sqlite.exec("INSERT INTO scenarios(id,name,trigger_type,trigger_keyword,is_active,account_id) VALUES(1,'Diagnosis','dm_keyword','plan_b',1,'a')");
        f.sqlite.exec("INSERT INTO scenario_steps(scenario_id,step_order,delay_minutes,message_type,body) VALUES(1,1,0,'text','{\"text\":\"Step one\"}')");
        f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
        await handleMessagingEvent(f.db, f.client as any, messagingEvent({ quick_reply: { payload: 'plan_b' } }), undefined, undefined, 'a');
        expect(f.sqlite.prepare('SELECT COUNT(*) n FROM follower_scenarios WHERE scenario_id=1').get()?.n).toBe(1);
        expect(f.client.sendText).toHaveBeenCalledWith('user-1', 'Step one');
    });

    it('plain text still branches through text as before', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        f.addGate('g', { trigger_type: 'dm_keyword', trigger_keyword: 'reference' });
        await handleMessagingEvent(f.db, f.client as any, messagingEvent({}), undefined, undefined, 'a');
        expect(f.client.sendGenericTemplate).toHaveBeenCalledOnce();
        const logged = f.sqlite.prepare("SELECT message_type FROM messages_log WHERE direction='in' ORDER BY id DESC LIMIT 1").get() as { message_type: string };
        expect(logged.message_type).toBe('text');
    });
});

describe('outbound stop switch in webhook paths (U22)', () => {
    it('skips gate sends while paused but keeps inbound bookkeeping', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        f.addGate('g', { trigger_type: 'dm_keyword', trigger_keyword: 'reference' });
        await setOutboundPaused(f.db, true);
        await handleMessagingEvent(f.db, f.client as any, messagingEvent({}), undefined, undefined, 'a');
        expect(f.client.sendGenericTemplate).not.toHaveBeenCalled();
        // inbound message still logged
        expect(f.sqlite.prepare("SELECT COUNT(*) n FROM messages_log WHERE direction='in'").get()?.n).toBe(1);
        // unpausing resumes the same trigger
        await setOutboundPaused(f.db, false);
        await handleMessagingEvent(f.db, f.client as any, { ...messagingEvent({}), message: { mid: 'mid-2', text: 'reference' } }, undefined, undefined, 'a');
        expect(f.client.sendGenericTemplate).toHaveBeenCalledOnce();
    });

    it('does not resume an awaiting-reply comment gate while paused', async () => {
        const f = await gateFixture();
        databases.push(f.sqlite);
        const { triggerGateForComment } = await import('../../services/engagement-gate.js');
        const { processCommentRuleJobs: processJobs } = await import('../../services/comment-rule-jobs.js');
        f.addGate();
        await triggerGateForComment(f.db, f.client as any, f.args);
        await processJobs(f.db, f.client as any, 'a');
        // private reply sent → delivery is cta_sent awaiting_reply=1
        expect(f.sqlite.prepare("SELECT json_extract(metadata,'$.awaiting_reply') ar, status FROM gate_deliveries").get()).toMatchObject({ ar: 1, status: 'cta_sent' });

        await setOutboundPaused(f.db, true);
        await handleMessagingEvent(f.db, f.client as any, messagingEvent({}), undefined, undefined, 'a');
        // the CTA on the user's reply is NOT sent while paused
        expect(f.client.sendGenericTemplate).not.toHaveBeenCalled();

        await setOutboundPaused(f.db, false);
        await handleMessagingEvent(f.db, f.client as any, { ...messagingEvent({}), message: { mid: 'mid-2', text: 'reference' } }, undefined, undefined, 'a');
        expect(f.client.sendGenericTemplate).toHaveBeenCalledOnce();
    });
});
