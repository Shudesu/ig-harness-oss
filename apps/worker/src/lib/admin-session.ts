import { getStaffByApiKey, getStaffById } from '@ig-harness/db';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import { constantTimeEqual, sha256 } from './security.js';
import { resolveAdminAuthConfig, resolveCorsOrigin } from '../middleware/admin-auth-config.js';
export const ADMIN_SESSION_COOKIE = 'ih_admin_session';
export const CSRF_COOKIE = 'ih_csrf';
export const SESSION_MAX_AGE = 7 * 86400;
export type Principal = Env['Variables']['staff'];
export type AdminSession = { id_hash: string; staff_id: string; credential_hash: string; csrf_hash: string; expires_at: number; staff: Principal };
export function readCookie(c: Pick<Context, 'req'>, name: string): string {
  const matches = (c.req.header('Cookie') ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  if (matches.length !== 1) return '';
  try { return decodeURIComponent(matches[0]!.slice(name.length + 1)); } catch { return ''; }
}
export function allowedBrowserOrigin(c: Context<Env>, required = true): boolean {
  const origin = c.req.header('Origin');
  if (!origin) return !required;
  return resolveCorsOrigin(c.env, origin, c.req.url) === origin;
}
export function cookie(c: Context<Env>, name: string, value: string, maxAge: number, httpOnly: boolean): string {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=${config.sameSite}${config.secure ? '; Secure' : ''}${httpOnly ? '; HttpOnly' : ''}`;
}
export function clearSessionCookies(c: Context<Env>): void {
  c.header('Set-Cookie', cookie(c, ADMIN_SESSION_COOKIE, '', 0, true), { append: true });
  c.header('Set-Cookie', cookie(c, CSRF_COOKIE, '', 0, false), { append: true });
}
export async function authenticateApiToken(c: Context<Env>, token: string): Promise<Principal | null> {
  if (!token.trim()) return null;
  // Preserve health-monitor authentication even when D1 is unavailable.
  if (await constantTimeEqual(token, c.env.API_KEY)) return { id: 'env-owner', name: 'Owner', role: 'owner' };
  const staff = await getStaffByApiKey(c.env.DB, token);
  return staff ? { id: staff.id, name: staff.name, role: staff.role } : null;
}
export async function getAdminSession(c: Context<Env>): Promise<AdminSession | null> {
  const id = readCookie(c, ADMIN_SESSION_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const session = await c.env.DB.prepare('SELECT * FROM admin_sessions WHERE id_hash=? AND expires_at>?').bind(await sha256(id), Date.now()).first<Omit<AdminSession,'staff'>>();
  if (!session) return null;
  let staff: Principal;
  if (session.staff_id === 'env-owner') {
    if (!c.env.API_KEY || !await constantTimeEqual(session.credential_hash, await sha256(c.env.API_KEY))) return null;
    staff = { id: 'env-owner', name: 'Owner', role: 'owner' };
  } else {
    const current = await getStaffById(c.env.DB, session.staff_id);
    if (!current?.is_active || !await constantTimeEqual(current.api_key, `sha256:${session.credential_hash}`)) return null;
    staff = { id: current.id, name: current.name, role: current.role };
  }
  return { ...session, staff };
}
export async function verifySessionCsrf(c: Context<Env>, session: AdminSession): Promise<boolean> {
  const header = c.req.header('X-CSRF-Token');
  const value = readCookie(c, CSRF_COOKIE);
  return allowedBrowserOrigin(c) && await constantTimeEqual(header, value) && await constantTimeEqual(await sha256(value), session.csrf_hash);
}
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
