import { it, expect } from 'vitest';
import { processFollowupDrip } from '../engagement-gate.js';
import { gateFixture } from '../../test-utils/gate-fixture.js';
async function fixture(inbound: string, delivered: string) { const f = await gateFixture(); f.addGate('g', { followup_dm_sequence: '[{"text":"Follow up","delay_minutes":1}]' }); f.sqlite.prepare('UPDATE followers SET last_inbound_at=?').run(inbound); f.sqlite.prepare("INSERT INTO gate_deliveries(id,gate_id,follower_id,igsid,status,delivered_at,next_followup_at) VALUES('d','g',1,'user-1','delivered',?,'2020-01-01')").run(delivered); return f; }
it('uses last inbound rather than a recent reward time to enforce the window', async () => { const f = await fixture(new Date(Date.now() - 25 * 3600000).toISOString(), new Date().toISOString()); try {
    expect(await processFollowupDrip(f.db, f.client as any, undefined, 50, undefined, 'a')).toEqual({ sent: 0, skipped: 1 });
    expect(f.client.sendText).not.toHaveBeenCalled();
    expect(f.sqlite.prepare('SELECT end_reason,next_followup_at FROM gate_deliveries').get()).toMatchObject({ end_reason: 'window_expired', next_followup_at: null });
}
finally {
    f.sqlite.close();
} });
it('allows a fresh inbound even when the reward is older than 24 hours', async () => { const f = await fixture(new Date().toISOString(), new Date(Date.now() - 48 * 3600000).toISOString()); try {
    expect((await processFollowupDrip(f.db, f.client as any, undefined, 50, undefined, 'a')).sent).toBe(1);
    expect(f.sqlite.prepare('SELECT followup_step_sent FROM gate_deliveries').get()?.followup_step_sent).toBe(1);
}
finally {
    f.sqlite.close();
} });
it('does not advance a failed followup as delivered', async () => { const f = await fixture(new Date().toISOString(), new Date().toISOString()); try {
    f.client.sendText.mockRejectedValue(new Error('offline'));
    expect((await processFollowupDrip(f.db, f.client as any, undefined, 50, undefined, 'a')).sent).toBe(0);
    expect(f.sqlite.prepare('SELECT followup_step_sent FROM gate_deliveries').get()?.followup_step_sent).toBe(0);
}
finally {
    f.sqlite.close();
} });
