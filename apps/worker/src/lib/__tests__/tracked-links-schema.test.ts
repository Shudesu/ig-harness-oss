import { it, expect } from 'vitest';
import { createTrackedLink, getTrackedLinkById, getTrackedLinks, recordLinkClick, getLinkClicks } from '@ig-harness/db';
import { testDatabase } from '../../test-utils/d1.js';
it('creates and tracks links using the real migrated schema while preserving legacy destinations', async () => {
  const { sqlite, db } = await testDatabase();
  try {
    sqlite.exec("INSERT INTO followers(id,igsid,name,account_id) VALUES(1,'123','Test','a'); INSERT INTO tracked_links(id,name,destination_url,ref_code,account_id) VALUES(42,'Legacy','https://example.com/legacy','old-ref','a')");
    expect((await getTrackedLinkById(db, '42'))?.original_url).toBe('https://example.com/legacy');
    sqlite.exec("INSERT INTO tags(id,name,account_id) VALUES(1,'Tag','a'); INSERT INTO scenarios(id,name,trigger_type,account_id) VALUES(1,'Scenario','manual','a')");
    const link = await createTrackedLink(db, { name: 'New', originalUrl: 'https://example.com/new', accountId: 'a', tagId: '1', scenarioId: '1' });
    expect(link.id).toBe('43'); expect(link.original_url).toBe('https://example.com/new'); expect(link.tag_id).toBe('1');
    sqlite.exec('DELETE FROM scenarios WHERE id=1; DELETE FROM tags WHERE id=1');
    expect(await getTrackedLinkById(db,link.id)).toMatchObject({ original_url: 'https://example.com/new', tag_id: null, scenario_id: null });
    const click = await recordLinkClick(db, link.id, '1'); expect(click.friend_id).toBe('1');
    expect((await getLinkClicks(db,link.id))[0]?.friend_display_name).toBe('Test');
    expect((await getTrackedLinkById(db,link.id))?.click_count).toBe(1);
    expect(await getTrackedLinks(db,{ accountId:'a' })).toHaveLength(2);
    expect(sqlite.prepare('SELECT ref_code FROM tracked_links WHERE id=42').get()?.ref_code).toBe('old-ref');
  } finally { sqlite.close(); }
});
