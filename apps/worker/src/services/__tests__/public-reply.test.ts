import { it, expect, describe } from 'vitest';
import { InstagramApiError } from '@ig-harness/ig-sdk';
import { gateFixture } from '../../test-utils/gate-fixture.js';
import { enqueueCommentRuleJob, processCommentRuleJobs } from '../comment-rule-jobs.js';
import { commentRulePublicReply } from '../../routes/webhook.js';
import { listDeliveryFailures, sanitizeErrorMessage, failureHint } from '../../lib/delivery-failures.js';

const fresh = () => new Date(Date.now() - 1000).toISOString();

describe('comment rule public reply', () => {
  it('calls the /{comment-id}/replies endpoint (replyToComment) for thread mode', async () => {
    const f = await gateFixture();
    try {
      await enqueueCommentRuleJob(f.db, { accountId: 'a', ruleId: 'r', commentId: 'c1', followerId: 1, messageType: 'text', body: '{"text":"DM本文"}', replyText: '公開返信', delaySeconds: 0, mediaId: 'm1', commentCreatedAt: fresh(), replyMode: 'thread' });
      await processCommentRuleJobs(f.db, f.client as any, 'a');
      expect(f.client.sendPrivateReply).toHaveBeenCalledWith('c1', 'DM本文');
      expect(f.client.replyToComment).toHaveBeenCalledWith('c1', '公開返信');
      expect(f.client.postCommentToMedia).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });

  it('uses a top-level media comment only when mention mode is selected', async () => {
    const f = await gateFixture();
    try {
      await enqueueCommentRuleJob(f.db, { accountId: 'a', ruleId: 'r', commentId: 'c1', followerId: 1, messageType: 'text', body: '{"text":"DM"}', replyText: '@person 見てね', delaySeconds: 0, mediaId: 'm1', commentCreatedAt: fresh(), replyMode: 'mention' });
      await processCommentRuleJobs(f.db, f.client as any, 'a');
      expect(f.client.postCommentToMedia).toHaveBeenCalledWith('m1', '@person 見てね');
      expect(f.client.replyToComment).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });

  it('does not post a public reply when the DM fails, and records the Meta error', async () => {
    const f = await gateFixture();
    try {
      f.client.sendPrivateReply.mockRejectedValueOnce(new InstagramApiError('(#200) Requires instagram_business_manage_messages permission', 403, 200));
      await enqueueCommentRuleJob(f.db, { accountId: 'a', ruleId: 'r', commentId: 'c1', followerId: 1, messageType: 'text', body: '{"text":"DM"}', replyText: '公開返信', delaySeconds: 0, commentCreatedAt: fresh() });
      await processCommentRuleJobs(f.db, f.client as any, 'a');
      expect(f.client.replyToComment).not.toHaveBeenCalled();
      expect(f.sqlite.prepare('SELECT status,error_code,error_message FROM comment_rule_jobs').get()).toMatchObject({ status: 'failed', error_code: 200, error_message: expect.stringContaining('instagram_business_manage_messages') });
      const failures = await listDeliveryFailures(f.db, 'a');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ source: 'private_reply', errorCode: 200, username: 'person', hint: expect.stringContaining('権限') });
    } finally { f.sqlite.close(); }
  });

  it('records skipped private replies (e.g. older than 7 days) in the failure log', async () => {
    const f = await gateFixture();
    try {
      await enqueueCommentRuleJob(f.db, { accountId: 'a', ruleId: 'r', commentId: 'c1', followerId: 1, messageType: 'text', body: '{"text":"DM"}', replyText: null, delaySeconds: 0, commentCreatedAt: new Date(Date.now() - 6.9 * 86400000).toISOString() });
      f.sqlite.exec("UPDATE comment_rule_jobs SET comment_created_at='2020-01-01T00:00:00Z'");
      await processCommentRuleJobs(f.db, f.client as any, 'a');
      expect((await listDeliveryFailures(f.db, 'a', { source: 'private_reply' }))[0]).toMatchObject({ stage: 'private_reply_expired', message: expect.stringContaining('7日') });
    } finally { f.sqlite.close(); }
  });

  it('separates the public reply text from the DM body (null=default, empty=none)', () => {
    expect(commentRulePublicReply(null, 'alice')).toBe('@alice コメントありがとう！📩 DMを送りました！');
    expect(commentRulePublicReply('', 'alice')).toBeNull();
    expect(commentRulePublicReply('{{username}}さん {{ username }}さん', 'bob')).toBe('bobさん bobさん');
  });
});

describe('failure log sanitizing', () => {
  it('masks credentials and truncates', () => {
    expect(sanitizeErrorMessage('bad access_token=IGAAabcdefghijklmnop&x=1')).toBe('bad access_token=****&x=1');
    expect(sanitizeErrorMessage('Bearer EAAB1234567890abcdef')).toBe('Bearer ****');
    expect(sanitizeErrorMessage('x'.repeat(10) + ' ' + 'y '.repeat(400))!.length).toBeLessThanOrEqual(300);
  });
  it('gives hints for common codes', () => {
    expect(failureHint(190)).toContain('トークン');
    expect(failureHint(10, 2018278)).toContain('24時間');
    expect(failureHint(613)).toContain('レート');
    expect(failureHint(999999)).toBeNull();
  });
});

describe('webhook processing failures', () => {
  it('records a failed webhook event with the Meta error in the failure log', async () => {
    const { queueWebhookEvents, drainWebhookEvents } = await import('../webhook-queue.js');
    const f = await gateFixture();
    try {
      await queueWebhookEvents(f.db, 'a', [{ kind: 'comments', value: { id: 'c9', from: { id: 'user-1' } } }]);
      await drainWebhookEvents(f.db, 'a', async () => { throw new InstagramApiError('x', 400, 100, undefined, undefined, 'Unsupported get request.'); });
      const [row] = await listDeliveryFailures(f.db, 'a', { source: 'webhook' });
      expect(row).toMatchObject({ source: 'webhook', stage: 'comments', errorCode: 100, message: 'Unsupported get request.' });
      expect(row!.refId).toMatch(/^comment:/);
    } finally { f.sqlite.close(); }
  });
});
