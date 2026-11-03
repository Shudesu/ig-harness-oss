import { issueTrackingToken, type TrackingEnv } from './tracking-token.js';
/** Final outbound boundary covers DM, broadcasts, scenarios and rich templates. */
export async function rewriteTrackedMessage(env: TrackingEnv, igsid: string, value: unknown): Promise<unknown> {
  if (typeof value === 'string') {
    const matches = [...value.matchAll(/https?:\/\/[^\s<>"']+/g)];
    let result = value;
    for (const match of matches.reverse()) {
      try {
        const url = new URL(match[0]);
        if (!env.WORKER_URL || url.origin !== new URL(env.WORKER_URL).origin) continue;
        const link = /^\/t\/([^/]+)$/.exec(url.pathname);
        if (!link) continue;
        for (const key of ['ig', 'lu', 'f', 't']) url.searchParams.delete(key);
        const token = igsid ? await issueTrackingToken(env, { purpose: 'link', linkId: decodeURIComponent(link[1]!), igsid }) : null;
        if (token) url.searchParams.set('t', token);
        result = result.slice(0, match.index) + url.href + result.slice(match.index! + match[0].length);
      } catch { /* Leave non-URL prose untouched. */ }
    }
    return result;
  }
  if (Array.isArray(value)) return Promise.all(value.map(v => rewriteTrackedMessage(env, igsid, v)));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, v]) => [key, await rewriteTrackedMessage(env, igsid, v)])));
  return value;
}
