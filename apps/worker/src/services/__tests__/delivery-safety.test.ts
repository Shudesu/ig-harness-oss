import { afterEach, describe, it, expect, vi } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import { processBroadcastSend } from '../broadcast.js';
import { drainWebhookEvents, queueWebhookEvents } from '../webhook-queue.js';
import { enqueueCommentRuleJob, processCommentRuleJobs } from '../comment-rule-jobs.js';
import { processSingleDelivery } from '../step-delivery.js';
import { pruneExpiredMessages } from '../retention.js';
const databases: Array<{ close(): void }> = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); });
async function fixture() {
  const result = await testDatabase(); databases.push(result.sqlite);
  result.sqlite.exec("INSERT INTO ig_accounts (id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES ('a','111','test',1,'2026-01-01','2026-01-01'); INSERT INTO broadcasts (id,name,message_type,body,account_id) VALUES (1,'Test','text','{\"text\":\"hello\"}','a')");
  return result;
}
const client = () => ({ sendText: vi.fn().mockResolvedValue({ message_id: 'sent' }), replyToComment: vi.fn().mockResolvedValue({ id: 'reply' }) });

describe('durable delivery', () => {
  it('checkpoints batches, excludes expired recipients, and concurrent resume never resends', async () => {
    const { sqlite, db } = await fixture();
    const now = new Date().toISOString();
    for (let i = 1; i <= 25; i++) sqlite.prepare('INSERT INTO followers (id,igsid,account_id,last_inbound_at) VALUES (?,?,?,?)').run(i, `${i}`, 'a', i === 25 ? '2020-01-01' : now);
    const ig = client();
    await Promise.all([processBroadcastSend(db, ig as any, 1, undefined, 'a'), processBroadcastSend(db, ig as any, 1, undefined, 'a')]);
    for (let i = 0; i < 4; i++) await processBroadcastSend(db, ig as any, 1, undefined, 'a');
    expect(ig.sendText).toHaveBeenCalledTimes(24);
    expect(new Set(ig.sendText.mock.calls.map((c) => c[0])).size).toBe(24);
    expect(sqlite.prepare('SELECT status,total_sent FROM broadcasts').get()).toMatchObject({ status: 'sent', total_sent: 24 });
    expect(sqlite.prepare("SELECT reason FROM broadcast_recipients WHERE follower_id=25").get()).toMatchObject({ reason: 'window_closed' });
  });
  it('does not retry a network failure whose outcome is unknown', async () => {
    const { sqlite, db } = await fixture();
    sqlite.prepare('INSERT INTO followers (id,igsid,account_id,last_inbound_at) VALUES (1,?,?,?)').run('123', 'a', new Date().toISOString());
    const ig = client(); ig.sendText.mockRejectedValue(new Error('network failure'));
    await processBroadcastSend(db, ig as any, 1, undefined, 'a');
    await processBroadcastSend(db, ig as any, 1, undefined, 'a');
    expect(ig.sendText).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare('SELECT status FROM broadcast_recipients').get()).toMatchObject({ status: 'uncertain' });
  });
  it('persists and deduplicates webhook events before draining, including concurrent drains', async () => {
    const { db, sqlite } = await fixture();
    const events = [{ kind: 'messaging', value: { sender: { id: '123' }, message: { mid: 'mid1', text: 'hello' } } }];
    await queueWebhookEvents(db, 'a', events); await queueWebhookEvents(db, 'a', events);
    const handle = vi.fn().mockResolvedValue(undefined);
    await Promise.all([drainWebhookEvents(db, 'a', handle), drainWebhookEvents(db, 'a', handle)]);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare('SELECT status,payload FROM webhook_events').get()).toMatchObject({ status: 'completed', payload: null });
  });
  it('queues delayed comments without sleeping and skips expired windows', async () => {
    const { db, sqlite } = await fixture();
    sqlite.exec("INSERT INTO followers(id,igsid,account_id,last_inbound_at) VALUES (1,'123','a','2020-01-01')");
    await enqueueCommentRuleJob(db, { accountId: 'a', ruleId: '1', commentId: 'comment1', followerId: 1, messageType: 'text', body: '{"text":"hello"}', replyText: 'sent', delaySeconds: 100 });
    const ig = client(); await processCommentRuleJobs(db, ig as any, 'a'); expect(ig.sendText).not.toHaveBeenCalled();
    sqlite.exec("UPDATE comment_rule_jobs SET due_at='2020-01-01'");
    await processCommentRuleJobs(db, ig as any, 'a');
    expect(ig.sendText).not.toHaveBeenCalled(); expect(ig.replyToComment).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT status,reason FROM comment_rule_jobs').get()).toMatchObject({ status: 'skipped', reason: 'window_closed' });
  });
  it('ends an expired scenario without an API call, preserving the reason', async () => {
    const { db, sqlite } = await fixture();
    sqlite.exec("INSERT INTO followers(id,igsid,account_id,last_inbound_at) VALUES(1,'123','a','2020-01-01'); INSERT INTO scenarios(id,name,trigger_type,account_id) VALUES(1,'Test','manual','a'); INSERT INTO follower_scenarios(id,follower_id,scenario_id) VALUES(1,1,1)");
    const ig = client();
    await processSingleDelivery(db, ig as any, { id: '1', follower_id: '1', scenario_id: '1', current_step: 0, status: 'active', next_step_at: null });
    expect(ig.sendText).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT status,end_reason FROM follower_scenarios').get()).toMatchObject({ status: 'completed', end_reason: 'window_expired' });
  });
  it('retention is disabled by default and prunes only older rows in bounded batches', async () => {
    const { db, sqlite } = await fixture();
    const insert = sqlite.prepare("INSERT INTO messages_log(direction,message_type,body,created_at) VALUES('in','text','{}',?)");
    for (let i = 0; i < 105; i++) insert.run('2020-01-01');
    insert.run(new Date().toISOString());
    await pruneExpiredMessages(db); expect(sqlite.prepare('SELECT COUNT(*) AS n FROM messages_log').get()?.n).toBe(106);
    await pruneExpiredMessages(db, '180'); expect(sqlite.prepare('SELECT COUNT(*) AS n FROM messages_log').get()?.n).toBe(6);
    await pruneExpiredMessages(db, '180'); expect(sqlite.prepare('SELECT COUNT(*) AS n FROM messages_log').get()?.n).toBe(1);
  });
});
it('uses a fresh profile cache and preserves the profile on refresh failure', async () => {
  const { db, sqlite } = await fixture();
  const { getOrRefreshFollower } = await import('../../routes/webhook.js');
  const ig = { getUserProfile: vi.fn().mockResolvedValue({ username: 'original', name: 'Test', is_user_follow_business: true }) };
  await getOrRefreshFollower(db, ig as any, '123', 'a');
  await getOrRefreshFollower(db, ig as any, '123', 'a'); expect(ig.getUserProfile).toHaveBeenCalledTimes(1);
  sqlite.exec("UPDATE followers SET profile_fetched_at='2020-01-01'"); ig.getUserProfile.mockRejectedValue(new Error('offline'));
  const follower = await getOrRefreshFollower(db, ig as any, '123', 'a'); expect(follower.username).toBe('original'); expect(follower.is_following).toBe(1);
});
