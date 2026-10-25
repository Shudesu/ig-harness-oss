const PREFIX = 'enc:v1:';
async function keyFor(secret?: string) {
  if (!secret) throw new Error('TOKEN_ENCRYPTION_KEY is required for credential storage');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)); } catch { throw new Error('Invalid TOKEN_ENCRYPTION_KEY'); }
  if (bytes.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must contain 32 base64-encoded bytes');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealToken(token: string, subject: string, secret?: string): Promise<string> {
  const key = await keyFor(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(subject) }, key, new TextEncoder().encode(token)));
  return PREFIX + btoa(String.fromCharCode(...iv, ...encrypted));
}
export async function openToken(token: string, subject: string, secret?: string): Promise<string> {
  if (!token.startsWith(PREFIX)) return token; // read-only compatibility during upgrade
  try {
    const raw = Uint8Array.from(atob(token.slice(PREFIX.length)), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(subject) }, await keyFor(secret), raw.slice(12)));
  } catch { throw new Error('Stored Instagram token cannot be decrypted; restore the original encryption key'); }
}
export async function encryptLegacyAccountTokens(db: D1Database, secret?: string): Promise<void> {
  if (!secret) return; // existing installs can read; installer/update provisions the key
  const rows = await db.prepare("SELECT id,ig_user_id,access_token,is_default FROM ig_accounts WHERE access_token NOT LIKE 'enc:v1:%' AND access_token != '' LIMIT 20")
    .all<{ id: string; ig_user_id: string; access_token: string; is_default: number }>();
  for (const row of rows.results) {
    const encrypted = await sealToken(row.access_token, row.ig_user_id, secret);
    const result = await db.prepare('UPDATE ig_accounts SET access_token=? WHERE id=? AND access_token=?').bind(encrypted, row.id, row.access_token).run();
    if (row.is_default && result.meta.changes) await db.prepare('DELETE FROM ig_token_state WHERE id=1').run();
  }
}
