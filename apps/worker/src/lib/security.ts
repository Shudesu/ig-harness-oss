export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function verifySignedRequest(raw: string, secret: string): Promise<{ user_id: string; issued_at: number } | null> {
  try {
    const parts = raw.split('.');
    if (parts.length !== 2 || !secret || parts.some((s) => !/^[A-Za-z0-9_-]+$/.test(s))) return null;
    const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
    const signature = decode(parts[0]!);
    if (signature.length !== 32) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(parts[1]!))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[1]!)));
    if (payload.algorithm !== 'HMAC-SHA256' || typeof payload.user_id !== 'string' || !/^\d{1,64}$/.test(payload.user_id)) return null;
    // Old signed requests can legitimately be retried. Replay is handled by the
    // deletion ledger; only reject impossible future or missing timestamps.
    if (!Number.isFinite(payload.issued_at) || payload.issued_at <= 0 || payload.issued_at > Date.now() / 1000 + 300) return null;
    return payload;
  } catch { return null; }
}
