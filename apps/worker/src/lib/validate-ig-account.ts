import { InstagramClient, InstagramApiError, detectTokenConnectionType, type IgConnectionType } from '@ig-harness/ig-sdk';
import type { Env } from '../index.js';

/**
 * access_token is the credential to persist: the submitted token, or the Page
 * access token when the IG account is reached through a linked Facebook Page.
 */
export type ValidatedIgAccount = { user_id: string; username: string; connection_type: IgConnectionType; page_id: string | null; access_token: string };

/** Explicit choice wins; otherwise the token prefix decides; unknown keeps the historical Instagram Login. */
export function resolveConnectionType(token: string, requested?: unknown): IgConnectionType {
    if (requested === 'instagram_login' || requested === 'facebook_login') return requested;
    if (requested !== undefined && requested !== null && requested !== '') throw new Error('connectionType must be instagram_login or facebook_login');
    return detectTokenConnectionType(token) ?? 'instagram_login';
}

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export async function validateIgAccount(env: Env['Bindings'], token: string, expectedId: string | undefined, appSecret?: string | null, options: { connectionType?: IgConnectionType } = {}): Promise<ValidatedIgAccount> {
    const secret = env.IG_REQUIRE_APPSECRET_PROOF === 'true' ? appSecret || env.IG_APP_SECRET : undefined;
    if (env.IG_REQUIRE_APPSECRET_PROOF === 'true' && !secret)
        throw new Error('Instagram App Secret is required for appsecret_proof');
    const connectionType = options.connectionType ?? resolveConnectionType(token);
    const base = { apiVersion: env.IG_GRAPH_API_VERSION, appSecret: secret, maxReadRetries: 0, connectionType };
    if (connectionType === 'facebook_login') {
        // Routing metadata always comes from the submitted credentials, so a
        // replaced token never keeps a stale Page. Unified login system-user
        // tokens list assigned IG accounts (no Page); Page-linked Facebook Login
        // tokens list Pages with their IG account and Page access token.
        let linked: Awaited<ReturnType<InstagramClient['listLinkedInstagramAccounts']>> = [];
        try { linked = await new InstagramClient({ ...base, accessToken: token, igUserId: 'me' }).listLinkedInstagramAccounts(); }
        catch (error) { if (!expectedId || !(error instanceof InstagramApiError)) throw error; }
        let match = expectedId ? linked.find((a) => a.igUserId === expectedId) : undefined;
        if (!expectedId) {
            if (linked.length === 0)
                throw new Error('No Instagram professional account was found for this token (assigned accounts or Facebook Pages). Enter the Instagram user ID shown in the Meta app (API setup with Unified login).');
            if (linked.length > 1)
                throw new Error(`This token can see ${linked.length} Instagram accounts. Enter the Instagram user ID to choose one: ${linked.map((a) => a.igUserId).join(', ')}`);
            match = linked[0];
        }
        const igUserId = expectedId ?? match!.igUserId;
        const pageId = match?.pageId ?? null;
        if (pageId && !match?.pageAccessToken)
            throw new Error('The linked Facebook Page did not return a Page access token. Check pages_show_list / pages_manage_metadata permissions and that you manage the Page.');
        const accessToken = pageId ? match!.pageAccessToken! : token;
        const profile = await new InstagramClient({ ...base, accessToken, igUserId, pageId }).getMe();
        if (typeof profile.user_id !== 'string' || !/^\d+$/.test(profile.user_id) || typeof profile.username !== 'string' || !USERNAME.test(profile.username))
            throw new Error('Facebook Login token could not read the Instagram account id and username. Check instagram_basic permission and the Instagram business asset.');
        if (profile.user_id !== igUserId)
            throw new Error('Token belongs to a different Instagram user_id');
        return { user_id: profile.user_id, username: profile.username, connection_type: connectionType, page_id: pageId, access_token: accessToken };
    }
    const client = new InstagramClient({ ...base, accessToken: token, igUserId: expectedId ?? 'me' });
    const profile = await client.getMe();
    if (typeof profile.user_id !== 'string' || !/^\d+$/.test(profile.user_id) || typeof profile.username !== 'string' || !USERNAME.test(profile.username))
        throw new Error('Instagram Login token did not return user_id and username');
    if (expectedId && profile.user_id !== expectedId)
        throw new Error('Token belongs to a different Instagram user_id');
    return { user_id: profile.user_id, username: profile.username, connection_type: connectionType, page_id: null, access_token: token };
}
