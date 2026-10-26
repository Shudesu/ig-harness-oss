export type MessagingEligibility = 'eligible' | 'window_expired' | 'standby';
export async function messagingEligibility(db: D1Database, followerId: string | number, accountId?: string, now = Date.now()): Promise<MessagingEligibility> {
    const row = await db.prepare(`SELECT last_inbound_at,messaging_owner FROM followers WHERE id=?${accountId ? ' AND account_id=?' : ''}`)
        .bind(followerId, ...(accountId ? [accountId] : [])).first<{
        last_inbound_at: string | null;
        messaging_owner: string;
    }>();
    if (row?.messaging_owner === 'standby')
        return 'standby';
    const time = row?.last_inbound_at ? Date.parse(row.last_inbound_at) : NaN;
    return Number.isFinite(time) && time <= now && time > now - 86400000 ? 'eligible' : 'window_expired';
}
