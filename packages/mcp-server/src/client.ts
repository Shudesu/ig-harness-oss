import { InstagramHarness } from '@ig-harness/sdk';
const instances = new Map<string, InstagramHarness>();
let warned = false;
export function getClient(accountId = process.env.IG_HARNESS_ACCOUNT_ID): InstagramHarness {
  const apiUrl = process.env.IG_HARNESS_API_URL ?? process.env.INSTAGRAM_HARNESS_API_URL;
  const apiKey = process.env.IG_HARNESS_API_KEY ?? process.env.INSTAGRAM_HARNESS_API_KEY;
  if (!apiUrl || !apiKey?.trim()) throw new Error('IG_HARNESS_API_URL and IG_HARNESS_API_KEY must be set');
  let url: URL;
  try { url = new URL(apiUrl); } catch { throw new Error('IG_HARNESS_API_URL must be an absolute HTTP(S) URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid IG_HARNESS_API_URL');
  if (process.env.IG_HARNESS_READ_ONLY && !['true', 'false'].includes(process.env.IG_HARNESS_READ_ONLY)) throw new Error('IG_HARNESS_READ_ONLY must be true or false');
  if (!warned && (process.env.INSTAGRAM_HARNESS_API_URL || process.env.INSTAGRAM_HARNESS_API_KEY)) {
    console.error('Deprecated INSTAGRAM_HARNESS_* variables: use IG_HARNESS_* instead.'); warned = true;
  }
  const key = accountId ?? '';
  if (!instances.has(key)) instances.set(key, new InstagramHarness({ apiUrl, apiKey, accountId }));
  return instances.get(key)!;
}
