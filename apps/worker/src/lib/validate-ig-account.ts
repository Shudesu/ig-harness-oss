import { InstagramClient } from '@ig-harness/ig-sdk';
import type { Env } from '../index.js';
export async function validateIgAccount(env: Env['Bindings'], token: string, expectedId: string | undefined, appSecret?: string | null) {
    const secret = env.IG_REQUIRE_APPSECRET_PROOF === 'true' ? appSecret || env.IG_APP_SECRET : undefined;
    if (env.IG_REQUIRE_APPSECRET_PROOF === 'true' && !secret)
        throw new Error('Instagram App Secret is required for appsecret_proof');
    const client = new InstagramClient({ accessToken: token, igUserId: expectedId ?? 'me', apiVersion: env.IG_GRAPH_API_VERSION, appSecret: secret, maxReadRetries: 0 });
    const profile = await client.getMe();
    if (typeof profile.user_id !== 'string' || !/^\d+$/.test(profile.user_id) || typeof profile.username !== 'string' || !/^[A-Za-z0-9._]{1,30}$/.test(profile.username))
        throw new Error('Instagram Login token did not return user_id and username');
    if (expectedId && profile.user_id !== expectedId)
        throw new Error('Token belongs to a different Instagram user_id');
    return { user_id: profile.user_id, username: profile.username };
}
