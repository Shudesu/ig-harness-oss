import { it, expect, vi } from 'vitest';
import { gateFixture } from '../../test-utils/gate-fixture.js';
import { sendCommentPrivateReply } from '../private-reply.js';
import { enqueueCommentRuleJob, processCommentRuleJobs, resumeCommentJobs } from '../comment-rule-jobs.js';
import { handleMessagingEvent } from '../../routes/webhook.js';
import { InstagramApiError } from '@ig-harness/ig-sdk';
import worker from '../../index.js';
it('allows only one private reply per comment, including concurrent attempts', async () => { const f = await gateFixture(); try {
    const args = { accountId: 'a', followerId: 1, commentId: 'c', text: 'Requested guide', createdAt: new Date(Date.now() - 1000).toISOString() };
    await Promise.all([sendCommentPrivateReply(f.db, f.client, args), sendCommentPrivateReply(f.db, f.client, args)]);
    await sendCommentPrivateReply(f.db, f.client, args);
    expect(f.client.sendPrivateReply).toHaveBeenCalledOnce();
    expect(f.client.sendText).not.toHaveBeenCalled();
}
finally {
    f.sqlite.close();
} });
it('does not send a private reply after seven days or auto-retry an unknown outcome', async () => { const f = await gateFixture(); try {
    const args = { accountId: 'a', followerId: 1, commentId: 'c', text: 'Requested guide' };
    expect(await sendCommentPrivateReply(f.db, f.client, { ...args, createdAt: '2020-01-01' })).toBe('expired');
    expect(f.client.sendPrivateReply).not.toHaveBeenCalled();
    f.client.sendPrivateReply.mockRejectedValue(new Error('offline'));
    await expect(sendCommentPrivateReply(f.db, f.client, args)).rejects.toThrow('offline');
    expect(await sendCommentPrivateReply(f.db, f.client, args)).toBe('outcome_unknown');
    expect(f.client.sendPrivateReply).toHaveBeenCalledOnce();
}
finally {
    f.sqlite.close();
} });
it('sends a text private reply without a DM window and posts the public reply only after success', async () => { const f = await gateFixture(); try {
    await enqueueCommentRuleJob(f.db, { accountId: 'a', ruleId: 'rule', commentId: 'c', followerId: 1, messageType: 'text', body: '{"text":"Guide URL"}', replyText: '@person check DM', delaySeconds: 0, mediaId: 'post', commentCreatedAt: new Date(Date.now() - 1000).toISOString() });
    await processCommentRuleJobs(f.db, f.client as any, 'a');
    expect(f.client.sendPrivateReply).toHaveBeenCalledWith('c', 'Guide URL');
    expect(f.client.sendText).not.toHaveBeenCalled();
    expect(f.client.replyToComment).toHaveBeenCalledWith('c', '@person check DM');
    expect(f.client.postCommentToMedia).not.toHaveBeenCalled();
}
finally {
    f.sqlite.close();
} });
it('preserves non-text content until the recipient responds', async () => { const f = await gateFixture(); try {
    await enqueueCommentRuleJob(f.db, { accountId: 'a', ruleId: 'rule', commentId: 'c', followerId: 1, messageType: 'image', body: '{"url":"https://example.com/gift.jpg"}', replyText: null, delaySeconds: 0, commentCreatedAt: new Date(Date.now() - 1000).toISOString() });
    await processCommentRuleJobs(f.db, f.client as any, 'a');
    expect(f.client.sendPrivateReply).toHaveBeenCalledOnce();
    expect(f.client.sendImage).not.toHaveBeenCalled();
    expect(f.sqlite.prepare('SELECT delivery_mode FROM comment_rule_jobs').get()?.delivery_mode).toBe('awaiting_inbound');
    f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
    await resumeCommentJobs(f.db, 1, 'a');
    await processCommentRuleJobs(f.db, f.client as any, 'a');
    expect(f.client.sendImage).toHaveBeenCalledWith('user-1', 'https://example.com/gift.jpg');
}
finally {
    f.sqlite.close();
} });
it('queues definite throttling failures but never blindly repeats a successful/unknown mutation', async () => { const f = await gateFixture(); try {
    f.client.sendPrivateReply.mockRejectedValueOnce(new InstagramApiError('limited', 429, 613));
    await enqueueCommentRuleJob(f.db, { accountId: 'a', ruleId: 'rule', commentId: 'c', followerId: 1, messageType: 'text', body: '{"text":"Guide"}', replyText: null, delaySeconds: 0, commentCreatedAt: new Date(Date.now() - 1000).toISOString() });
    await processCommentRuleJobs(f.db, f.client as any, 'a');
    expect(f.sqlite.prepare('SELECT status,error_code FROM comment_rule_jobs').get()).toMatchObject({ status: 'pending', error_code: 613 });
    f.sqlite.exec("UPDATE comment_rule_jobs SET due_at='2020-01-01'");
    await processCommentRuleJobs(f.db, f.client as any, 'a');
    expect(f.client.sendPrivateReply).toHaveBeenCalledTimes(2);
    expect(f.sqlite.prepare('SELECT status FROM comment_rule_jobs').get()?.status).toBe('sent');
}
finally {
    f.sqlite.close();
} });
it('records standby messages without profile calls, triggers, or scenario sends', async () => { const f = await gateFixture(); try {
    f.addGate('g', { trigger_type: 'dm_keyword', trigger_keyword: 'guide' });
    const event = { sender: { id: 'user-1' }, recipient: { id: '111' }, timestamp: Date.now(), message: { mid: 'mid', text: 'guide' } };
    await handleMessagingEvent(f.db, f.client as any, event, undefined, undefined, 'a', true);
    expect(f.client.getUserProfile).not.toHaveBeenCalled();
    expect(f.client.sendText).not.toHaveBeenCalled();
    expect(f.client.sendGenericTemplate).not.toHaveBeenCalled();
    expect(f.sqlite.prepare('SELECT messaging_owner FROM followers').get()?.messaging_owner).toBe('standby');
    expect(f.sqlite.prepare('SELECT direction FROM messages_log').get()?.direction).toBe('in');
}
finally {
    f.sqlite.close();
} });
it('rejects out-of-window manual DM before any Graph call', async () => { const f = await gateFixture(); try {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(new Request('https://worker.example/api/friends/1/messages', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{"content":"{\\"text\\":\\"hello\\"}"}' }), { DB: f.db, API_KEY: 'owner', IG_USER_ID: '111' } as any, { waitUntil() { }, passThroughOnException() { } } as any);
    expect(response.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
}
finally {
    vi.unstubAllGlobals();
    f.sqlite.close();
} });
it('creates a comment rule on the migrated schema and sends via comment_id after a queued event', async () => { const f = await gateFixture(); try {
    const { queueWebhookEvents } = await import('../webhook-queue.js');
    const { processQueuedWebhooks } = await import('../../routes/webhook.js');
    f.sqlite.exec("INSERT INTO integration_settings(key,value) VALUES('account_backfill_done','1')");
    const response = await worker.fetch(new Request('https://worker.example/api/comment-rules', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Guide', keyword: 'guide', responseType: 'text', responseBody: { text: 'Requested information' } }) }), { DB: f.db, API_KEY: 'owner', IG_USER_ID: '111' } as any, { waitUntil() { }, passThroughOnException() { } } as any);
    expect(response.status).toBe(201);
    await queueWebhookEvents(f.db, 'a', [{ kind: 'comments', value: { id: 'comment', text: 'guide', from: { id: 'user-1', username: 'person' }, media: { id: 'post' }, created_time: new Date(Date.now() - 1000).toISOString() } }]);
    const account = f.sqlite.prepare("SELECT * FROM ig_accounts WHERE id='a'").get();
    await processQueuedWebhooks(f.db, f.client as any, account as any);
    expect(f.client.sendPrivateReply).toHaveBeenCalledWith('comment', 'Requested information');
    expect(f.client.sendText).not.toHaveBeenCalled();
}
finally {
    f.sqlite.close();
} });
it('retries a rate-limited broadcast later, preserves the error code while pending, and clears it on success', async () => { const f = await gateFixture(); try {
    const { processBroadcastSend } = await import('../broadcast.js');
    f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());
    f.sqlite.exec("INSERT INTO broadcasts(id,name,message_type,body,account_id) VALUES(1,'Send','text','{\"text\":\"Hello\"}','a')");
    f.client.sendText.mockRejectedValueOnce(new InstagramApiError('limited', 429, 80002));
    await processBroadcastSend(f.db, f.client as any, 1, undefined, 'a');
    expect(f.sqlite.prepare('SELECT status,error_code FROM broadcast_recipients').get()).toMatchObject({ status: 'pending', error_code: 80002 });
    await processBroadcastSend(f.db, f.client as any, 1, undefined, 'a');
    expect(f.client.sendText).toHaveBeenCalledOnce();
    f.sqlite.exec("UPDATE broadcast_recipients SET next_attempt_at='2020-01-01'");
    await processBroadcastSend(f.db, f.client as any, 1, undefined, 'a');
    expect(f.client.sendText).toHaveBeenCalledTimes(2);
    expect(f.sqlite.prepare('SELECT status,error_code FROM broadcast_recipients').get()).toMatchObject({ status: 'sent', error_code: null });
}
finally {
    f.sqlite.close();
} });
it('allows a fresh comment after a definite gate rejection while preserving the failed attempt',async()=>{
  const f=await gateFixture();try{
    const {triggerGateForComment}=await import('../engagement-gate.js');f.addGate();f.client.sendPrivateReply.mockRejectedValueOnce(new InstagramApiError('expired',401,190));
    await triggerGateForComment(f.db,f.client as any,f.args);await processCommentRuleJobs(f.db,f.client as any,'a');
    expect(f.sqlite.prepare('SELECT status FROM comment_rule_jobs').get()?.status).toBe('failed');
    await triggerGateForComment(f.db,f.client as any,{...f.args,commentId:'fresh-comment'});await processCommentRuleJobs(f.db,f.client as any,'a');
    expect(f.client.sendPrivateReply).toHaveBeenCalledTimes(2);expect(f.sqlite.prepare("SELECT COUNT(*) n FROM comment_rule_jobs WHERE status='failed'").get()?.n).toBe(1);expect(f.sqlite.prepare('SELECT status FROM gate_deliveries').get()?.status).toBe('cta_sent');
  }finally{f.sqlite.close();}
});
it('clears the processing reason on a successful scenario and rejects a stale second claim',async()=>{
 const f=await gateFixture();try{
  const {processSingleDelivery}=await import('../step-delivery.js');const due=new Date().toISOString();f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(due);
  f.sqlite.exec("INSERT INTO scenarios(id,name,trigger_type,account_id) VALUES(1,'Test','manual','a'); INSERT INTO scenario_steps(scenario_id,step_order,delay_minutes,message_type,body) VALUES(1,1,0,'text','{\"text\":\"One step\"}')");
  f.sqlite.prepare("INSERT INTO follower_scenarios(id,follower_id,scenario_id,next_step_at) VALUES(1,1,1,?)").run(due);
  const state={id:'1',follower_id:'1',scenario_id:'1',current_step:0,status:'active',next_step_at:due};
  await processSingleDelivery(f.db,f.client as any,state,undefined,true);await processSingleDelivery(f.db,f.client as any,state,undefined,true);
  expect(f.client.sendText).toHaveBeenCalledOnce();expect(f.sqlite.prepare('SELECT status,end_reason FROM follower_scenarios').get()).toMatchObject({status:'completed',end_reason:null});
 }finally{f.sqlite.close();}
});
it('does not send queued private replies or followups while a gate is paused',async()=>{
 const f=await gateFixture();try{const {triggerGateForComment,processFollowupDrip}=await import('../engagement-gate.js');f.addGate('g',{followup_dm_sequence:'[{"text":"Followup","delay_minutes":1}]'});await triggerGateForComment(f.db,f.client as any,f.args);f.sqlite.exec("UPDATE engagement_gates SET status='paused'");await processCommentRuleJobs(f.db,f.client as any,'a');expect(f.client.sendPrivateReply).not.toHaveBeenCalled();f.sqlite.exec("UPDATE gate_deliveries SET status='delivered',next_followup_at='2020-01-01'");f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(new Date().toISOString());await processFollowupDrip(f.db,f.client as any,undefined,50,undefined,'a');expect(f.client.sendText).not.toHaveBeenCalled();}finally{f.sqlite.close();}
});
it('resumes a comment gate after an attachment response without repeating the private reply', async () => {
  const f = await gateFixture();
  try {
    const { triggerGateForComment } = await import('../engagement-gate.js');
    f.addGate();
    await triggerGateForComment(f.db, f.client as any, f.args);
    await processCommentRuleJobs(f.db, f.client as any, 'a');
    const event = { sender: { id: 'user-1' }, recipient: { id: '111' }, timestamp: Date.now(), message: { mid: 'photo-reply', attachments: [{ type: 'image' as const, payload: { url: 'https://example.com/reply.jpg' } }] } };
    await handleMessagingEvent(f.db, f.client as any, event, undefined, undefined, 'a');
    expect(f.client.sendPrivateReply).toHaveBeenCalledOnce();
    expect(f.client.sendGenericTemplate).toHaveBeenCalledOnce();
    expect(f.sqlite.prepare("SELECT COUNT(*) n FROM messages_log WHERE direction='in'").get()?.n).toBe(1);
  } finally {
    f.sqlite.close();
  }
});
