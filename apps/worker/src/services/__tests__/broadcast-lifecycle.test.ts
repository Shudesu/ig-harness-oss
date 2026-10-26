import { afterEach, expect, it, vi } from 'vitest';
import { testDatabase } from '../../test-utils/d1.js';
import { updateBroadcast, deleteBroadcast } from '@ig-harness/db';
import { processBroadcastSend } from '../broadcast.js';
const databases: Array<{ close(): void }> = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function fixture() {
  const state = await testDatabase(); databases.push(state.sqlite);
  state.sqlite.exec("INSERT INTO broadcasts(id,name,message_type,body,account_id) VALUES(1,'Test','text','{\"text\":\"original\"}','a')");
  state.sqlite.prepare('INSERT INTO followers(id,igsid,account_id,last_inbound_at) VALUES(1,?,?,?)').run('123','a',new Date().toISOString());
  return state;
}
it('rejects late edits and deletions after delivery has started at the SQL boundary', async () => {
  const { sqlite, db } = await fixture(); sqlite.exec("UPDATE broadcasts SET status='sending'");
  expect(await updateBroadcast(db, 1, { body: '{"text":"changed"}', status: 'draft' })).toBeNull();
  expect(await deleteBroadcast(db, 1)).toBe(false);
  expect(sqlite.prepare('SELECT status,body FROM broadcasts WHERE id=1').get()).toMatchObject({ status: 'sending', body: '{"text":"original"}' });
});
it('sends the version frozen by the claim when a draft edit wins the race', async () => {
  const { sqlite, db } = await fixture(); let raced = false;
  const raceDb = { ...db, prepare(sql: string) {
    const statement = db.prepare(sql);
    if (!/SELECT \* FROM broadcasts WHERE id = \?/.test(sql)) return statement;
    return { ...statement, bind(...args: any[]) {
      const bound = statement.bind(...args);
      return { ...bound, first: async () => {
        const row = await bound.first();
        if (!raced) { raced = true; await updateBroadcast(db, 1, { body: '{"text":"edited before claim"}' }); }
        return row;
      } };
    } };
  } } as D1Database;
  const client = { sendText: vi.fn().mockResolvedValue({ message_id: 'test' }) };
  await processBroadcastSend(raceDb, client as any, 1, undefined, 'a');
  expect(client.sendText).toHaveBeenCalledWith('123', 'edited before claim');
  expect(sqlite.prepare('SELECT body FROM messages_log').get()).toMatchObject({ body: '{"text":"edited before claim"}' });
});
it('does not call Instagram if the draft is deleted before it can be claimed', async () => {
  const { sqlite, db } = await fixture(); let raced = false;
  const raceDb = { ...db, prepare(sql: string) {
    const statement = db.prepare(sql);
    if (!/SELECT \* FROM broadcasts WHERE id = \?/.test(sql)) return statement;
    return { ...statement, bind(...args: any[]) {
      const bound = statement.bind(...args);
      return { ...bound, first: async () => {
        const row = await bound.first();
        if (!raced) { raced = true; sqlite.exec('DELETE FROM broadcasts WHERE id=1'); }
        return row;
      } };
    } };
  } } as D1Database;
  const client = { sendText: vi.fn() };
  await expect(processBroadcastSend(raceDb, client as any, 1, undefined, 'a')).rejects.toThrow();
  expect(client.sendText).not.toHaveBeenCalled();
});
it('rejects malformed tag targets before changing a draft to sending', async () => {
  const { sqlite, db } = await fixture(); sqlite.prepare('UPDATE broadcasts SET tag_filter=? WHERE id=1').run('{"tagId":{"wrong":"shape"}}');
  const client = { sendText: vi.fn() };
  await expect(processBroadcastSend(db, client as any, 1, undefined, 'a')).rejects.toThrow('tagId');
  expect(sqlite.prepare('SELECT status FROM broadcasts WHERE id=1').get()).toMatchObject({ status: 'draft' });
  expect(client.sendText).not.toHaveBeenCalled();
});
