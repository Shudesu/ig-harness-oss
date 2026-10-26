import { InstagramApiError, type GraphObservation } from '@ig-harness/ig-sdk';
import { recordTokenValidity } from './health.js';
export async function assertGraphAvailable(db: D1Database, accountId: string): Promise<void> {
    const row = await db.prepare('SELECT value FROM integration_settings WHERE key=?').bind(`health:graph_backoff_until:${accountId}`).first<{
        value: string;
    }>();
    const until = Number(row?.value ?? 0);
    if (until > Date.now())
        throw new InstagramApiError('Instagram API is cooling down; check account health', 429, 613, undefined, until - Date.now());
}
export function graphObserver(db: D1Database, accountId: string) {
    let lastUsage = '';
    return async (value: GraphObservation): Promise<void> => {
        if (value.code === 190)
            await recordTokenValidity(db, accountId, false, 'token_expired');
        const usage = JSON.stringify(value.usage);
        if (usage !== '{}' && usage !== lastUsage) {
            lastUsage = usage;
            await db.prepare("INSERT INTO integration_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=? WHERE value!=excluded.value")
                .bind(`health:graph_usage:${accountId}`, usage, new Date().toISOString()).run();
        }
        if (value.status === 429 || [4, 17, 32, 613, 80002].includes(value.code ?? -1)) {
            const delay = Number.isFinite(value.retryAfterMs) ? Math.max(1000, value.retryAfterMs!) : 60000;
            await db.prepare("INSERT INTO integration_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=MAX(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER))")
                .bind(`health:graph_backoff_until:${accountId}`, String(Date.now() + delay)).run();
        }
    };
}
