import { createAppSecretProof } from '../../../../packages/ig-sdk/src/proof.js';
import { graphApiVersion } from '../../../../packages/ig-sdk/src/config.js';
export const INSTAGRAM_API_VERSION = graphApiVersion(process.env.IG_GRAPH_API_VERSION);
export const WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'messaging_referral', 'comments'];
async function graph(token: string, path: string, method = 'GET', body?: URLSearchParams, appSecret?: string): Promise<any> {
  const url=new URL(`https://graph.instagram.com/${INSTAGRAM_API_VERSION}/${path}`);
  if (process.env.IG_REQUIRE_APPSECRET_PROOF==='true') url.searchParams.set('appsecret_proof',await createAppSecretProof(token,appSecret ?? ''));
  const res = await fetch(url.href, {
    method, headers: { Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Instagram API validation failed (HTTP ${res.status}). Check Instagram Login token and permissions.`);
  return res.json();
}
export async function validateInstagramToken(token: string, appSecret?: string): Promise<{ userId: string; username: string }> {
  const profile = await graph(token, 'me?fields=user_id,username', 'GET', undefined, appSecret);
  if (typeof profile.user_id !== 'string' || !/^\d+$/.test(profile.user_id) || typeof profile.username !== 'string') throw new Error('Instagram Login /me did not return user_id and username; do not use a Facebook Page token or app-scoped id.');
  return { userId: profile.user_id, username: profile.username };
}
export async function subscribeInstagramAccount(token: string, userId: string, appSecret?: string): Promise<void> {
  const path = `${encodeURIComponent(userId)}/subscribed_apps`;
  const result = await graph(token, path, 'POST', new URLSearchParams({ subscribed_fields: WEBHOOK_FIELDS.join(',') }), appSecret);
  if (result.success !== true) throw new Error('Instagram account subscription was not accepted');
  const current = await graph(token, path, 'GET', undefined, appSecret);
  const fields = new Set((current.data ?? []).flatMap((entry: { subscribed_fields?: string[] }) => entry.subscribed_fields ?? []));
  if (WEBHOOK_FIELDS.some((field) => !fields.has(field))) throw new Error('Instagram account subscription is incomplete; check app fields and permissions.');
}
