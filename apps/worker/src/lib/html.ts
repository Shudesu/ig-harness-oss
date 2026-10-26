import type { Context } from 'hono';
export { escapeHtml } from './security.js';
export function isHttpDestination(value: unknown): value is string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function serializeInlineScriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function publicPageHeaders(c: Pick<Context, 'header'>, nonce?: string): void {
  c.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
}
