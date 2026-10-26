import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { deliveryStatus } from '../delivery-status.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';

it('returns delivery reasons only for the selected account and no credentials', async () => {
  const f = await gateFixture();
  try {
    f.sqlite.exec(`
      INSERT INTO ig_accounts(id,ig_user_id,access_token,is_default,created_at,updated_at) VALUES('b','222','private-token',0,'2026-01-01','2026-01-01');
      INSERT INTO followers(id,igsid,username,account_id) VALUES(2,'user-2','other-person','b');
      INSERT INTO comment_rule_jobs(id,account_id,follower_id,comment_id,message_type,body,due_at,expires_at,status,reason,error_code)
        VALUES('job-a','a',1,'comment-a','text','{}','2026-01-01','2026-01-02','failed','rate_limited',613),
              ('job-b','b',2,'comment-b','text','{}','2026-01-01','2026-01-02','failed','private_reply_expired',NULL);
    `);
    const app = new Hono<any>();
    app.route('/', deliveryStatus);
    const env = { DB: f.db, IG_USER_ID: '111', IG_ACCESS_TOKEN: 'test' };
    const response = await app.request('https://worker.example/api/delivery-status?account_id=a', {}, env);
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.data.account.account_id).toBe('a');
    expect(result.data.deliveries).toEqual([expect.objectContaining({ id: 'job-a', reason: 'rate_limited', errorCode: 613 })]);
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(JSON.stringify(result)).not.toContain('other-person');
    expect((await app.request('https://worker.example/api/delivery-status?account_id=missing', {}, env)).status).toBe(404);
  } finally {
    f.sqlite.close();
  }
});
