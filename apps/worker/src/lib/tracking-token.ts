export interface TrackingEnv {
  TRACKING_SIGNING_SECRET?: string;
  TRACKING_ALLOW_UNSIGNED_ACTIONS?: string;
  API_KEY?: string;
  IG_APP_SECRET?: string;
  IG_LINK_TOKEN_SECRET?: string;
  LINE_HARNESS_LINK_SECRET?: string;
  WORKER_URL?: string;
}
const encoder = new TextEncoder();
export const TOKEN_TTL = 7 * 24 * 60 * 60;
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function deriveKey(secret: string, purpose: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encoder.encode(purpose) }, key, 256));
}
let warned = false;
async function trackingKey(env: TrackingEnv): Promise<Uint8Array | null> {
  if (env.TRACKING_SIGNING_SECRET) return encoder.encode(env.TRACKING_SIGNING_SECRET);
  if (!warned) { console.warn('[tracking] dedicated signing key missing; using purpose-separated fallback or anonymous links'); warned = true; }
  const secret = env.API_KEY || env.IG_APP_SECRET;
  return secret ? deriveKey(secret, 'ig-tracking-token-v1') : null;
}
async function destinationHash(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
async function sign(payload: object, bytes: Uint8Array): Promise<string> {
  const part = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return part + '.' + base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(part))));
}
export interface TrackingPayload {
  v: 1; purpose: 'link' | 'gate'; linkId: string; exp: number; n: string;
  igsid?: string; followerId?: string; destination?: string;
}
export async function issueTrackingToken(env: TrackingEnv, input: Omit<TrackingPayload, 'v' | 'exp' | 'n'>, now = Date.now()): Promise<string | null> {
  const key = await trackingKey(env);
  return key ? sign({ ...input, ...(input.destination !== undefined ? { destination: await destinationHash(input.destination) } : {}), v: 1, exp: Math.floor(now / 1000) + TOKEN_TTL, n: base64url(crypto.getRandomValues(new Uint8Array(16))) }, key) : null;
}
export async function verifyTrackingToken(env: TrackingEnv, token: string, purpose: TrackingPayload['purpose'], linkId: string, destination?: string, now = Date.now()): Promise<TrackingPayload | null> {
  try {
    if (token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const bytes = await trackingKey(env);
    if (!bytes) return null;
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    // Web Crypto verifies the MAC in constant time; never compare signature strings.
    if (!await crypto.subtle.verify('HMAC', key, decode(parts[1]!), encoder.encode(parts[0]!))) return null;
    const p = JSON.parse(new TextDecoder().decode(decode(parts[0]!))) as TrackingPayload;
    const seconds = Math.floor(now / 1000);
    if (p.v !== 1 || p.purpose !== purpose || p.linkId !== linkId || !Number.isSafeInteger(p.exp) || p.exp <= seconds || p.exp > seconds + TOKEN_TTL || !/^[A-Za-z0-9_-]{22}$/.test(p.n)) return null;
    if (purpose === 'gate' && (destination === undefined || p.destination !== await destinationHash(destination))) return null;
    if (!!p.igsid === !!p.followerId || (p.igsid && (typeof p.igsid !== 'string' || p.igsid.length > 128)) || (p.followerId && (typeof p.followerId !== 'string' || !/^[1-9]\d*$/.test(p.followerId)))) return null;
    return p;
  } catch { return null; }
}
// LINE spec 08 wire format. Shared secret is independent of local tracking keys.
export async function issueIgLinkToken(env: TrackingEnv, igsid: string, iga?: string): Promise<string | null> {
  const key = env.IG_LINK_TOKEN_SECRET ? encoder.encode(env.IG_LINK_TOKEN_SECRET)
    : env.LINE_HARNESS_LINK_SECRET ? await deriveKey(env.LINE_HARNESS_LINK_SECRET, 'ig-link-token-v1') : null;
  if (!key) { console.warn('[ig-link] shared signing key missing; emitting anonymous LINE link'); return null; }
  return sign({ v: 1, igsid, ...(iga ? { iga } : {}), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL, n: base64url(crypto.getRandomValues(new Uint8Array(16))) }, key);
}
