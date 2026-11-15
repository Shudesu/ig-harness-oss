import { InstagramClient, detectTokenConnectionType, type IgConnectionType } from '@ig-harness/ig-sdk';
import type { Env } from '../index.js';

export type ValidatedIgAccount = { user_id: string; username: string; connection_type: IgConnectionType; page_id: string | null };

/** Explicit choice wins; otherwise the token prefix decides; unknown keeps the historical Instagram Login. */
export function resolveConnectionType(token: string, requested?: unknown): IgConnectionType {
    if (requested === 'instagram_login' || requested === 'facebook_login') return requested;
    if (requested !== undefined && requested !== null && requested !== '') throw new Error('connectionType must be instagram_login or facebook_login');
    return detectTokenConnectionType(token) ?? 'instagram_login';
}

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export async function validateIgAccount(env: Env['Bindings'], token: string, expectedId: string | undefined, appSecret?: string | null, options: { connectionType?: IgConnectionType; pageId?: string | null } = {}): Promise<ValidatedIgAccount> {
    const secret = env.IG_REQUIRE_APPSECRET_PROOF === 'true' ? appSecret || env.IG_APP_SECRET : undefined;
    if (env.IG_REQUIRE_APPSECRET_PROOF === 'true' && !secret)
        throw new Error('Instagram App Secret is required for appsecret_proof');
    const connectionType = options.connectionType ?? resolveConnectionType(token);
    const base = { accessToken: token, apiVersion: env.IG_GRAPH_API_VERSION, appSecret: secret, maxReadRetries: 0, connectionType };
    if (connectionType === 'facebook_login') {
        let igUserId = expectedId;
        let pageId: string | null = options.pageId ?? null;
        if (!igUserId) {
            // No IG user id given: find the IG professional account through the
            // Unified login assignment (/me/assigned_instagram_accounts) or the Facebook
            // Pages this token manages (/me/accounts → instagram_business_account).
            const linked = await new InstagramClient({ ...base, igUserId: 'me' }).listLinkedInstagramAccounts();
            if (linked.length === 0)
                throw new Error('No Instagram professional account was found for this token (assigned accounts or Facebook Pages). Enter the Instagram user ID shown in the Meta app (API setup with Unified login).');
            if (linked.length > 1)
                throw new Error(`This token can see ${linked.length} Instagram accounts. Enter the Instagram user ID to choose one: ${linked.map((a) => a.igUserId).join(', ')}`);
            igUserId = linked[0]!.igUserId;
            pageId = linked[0]!.pageId ?? null;
        }
        const profile = await new InstagramClient({ ...base, igUserId, pageId }).getMe();
        if (typeof profile.user_id !== 'string' || !/^\d+$/.test(profile.user_id) || typeof profile.username !== 'string' || !USERNAME.test(profile.username))
            throw new Error('Facebook Login token could not read the Instagram account id and username. Check instagram_basic permission and the Instagram business asset.');
        if (profile.user_id !== igUserId)
            throw new Error('Token belongs to a different Instagram user_id');
        return { user_id: profile.user_id, username: profile.username, connection_type: connectionType, page_id: pageId };
    }
    const client = new InstagramClient({ ...base, igUserId: expectedId ?? 'me' });
    const profile = await client.getMe();
    if (typeof profile.user_id !== 'string' || !/^\d+$/.test(profile.user_id) || typeof profile.username !== 'string' || !USERNAME.test(profile.username))
        throw new Error('Instagram Login token did not return user_id and username');
    if (expectedId && profile.user_id !== expectedId)
        throw new Error('Token belongs to a different Instagram user_id');
    return { user_id: profile.user_id, username: profile.username, connection_type: connectionType, page_id: null };
}
