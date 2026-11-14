import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Entitlements, PlanTier, Role, SessionUser, Timeframe } from '@/lib/types';
import { getDb, verifyPassword, type Database, type UserRecord } from './db';

/**
 * §4.2  Three-field session authority: Username + Password + License Key.
 * Sessions are HMAC-signed, http-only cookies — no API keys, no wallet custody,
 * no self-serve checkout (§1.1 explicit non-goals).
 */

export const SESSION_COOKIE = 'alpha_x_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface SessionPayload {
  uid: string;
  exp: number;
}

function secret(db: Database): string {
  return db.secret;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signSession(db: Database, userId: string): string {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + SESSION_TTL_MS };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret(db)).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySessionToken(db: Database, token: string): string | null {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = b64url(createHmac('sha256', secret(db)).update(body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.uid || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionUserFromToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const db = getDb();
  const uid = verifySessionToken(db, token);
  if (!uid) return null;
  const u = db.userById(uid);
  if (!u || u.isSuspended) return null;
  return toSessionUser(db, u);
}

export function toSessionUser(db: Database, u: UserRecord): SessionUser {
  const lic = db.licenseOf(u);
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    plan: u.plan,
    whatsappNumber: u.whatsappNumber,
    isSuspended: u.isSuspended,
    entitlements: db.entitlementsOf(u),
    licenseKey: lic?.keyString ?? null,
    licenseExpiresAt: lic?.expiresAt ?? null,
    preferredTimeframe: u.preferredTimeframe as Timeframe,
    tileDensity: u.tileDensity,
    soundEnabled: u.soundEnabled,
    chartMode: u.chartMode,
    timezonePref: u.timezonePref,
    watchlistSymbols: u.watchlistSymbols,
    acceptedDisclaimerAt: u.acceptedDisclaimerAt,
  };
}

export type LoginFailure =
  | 'MISSING_FIELDS'
  | 'BAD_CREDENTIALS'
  | 'BAD_LICENSE'
  | 'LICENSE_IN_USE'
  | 'LICENSE_EXPIRED'
  | 'SUSPENDED';

export interface LoginResult {
  ok: boolean;
  reason?: LoginFailure;
  user?: SessionUser;
  token?: string;
}

/**
 * Validate all three fields. A License Key is bound to the user on first use
 * and re-validated on every subsequent login; entitlements are copied from the
 * key's grant booleans onto the user (§10 module 2).
 */
export function login(username: string, password: string, licenseKey: string): LoginResult {
  const db = getDb();
  if (!username.trim() || !password || !licenseKey.trim()) return { ok: false, reason: 'MISSING_FIELDS' };

  const user = db.userByUsername(username.trim());
  if (!user) return { ok: false, reason: 'BAD_CREDENTIALS' };
  if (!verifyPassword(password, user.passwordHash)) return { ok: false, reason: 'BAD_CREDENTIALS' };
  if (user.isSuspended) return { ok: false, reason: 'SUSPENDED' };

  const key = db.licenseByKey(licenseKey.trim());
  if (!key) return { ok: false, reason: 'BAD_LICENSE' };
  if (key.status === 'REVOKED') return { ok: false, reason: 'BAD_LICENSE' };
  if (key.expiresAt !== null && key.expiresAt < Date.now()) return { ok: false, reason: 'LICENSE_EXPIRED' };
  if (key.assignedUserId !== null && key.assignedUserId !== user.id) return { ok: false, reason: 'LICENSE_IN_USE' };

  const now = Date.now();
  if (key.activatedAt === null) {
    key.activatedAt = now;
    key.expiresAt = now + key.durationDays * 86_400_000;
  }
  key.assignedUserId = user.id;
  user.licenseKeyId = key.id;

  // Entitlements follow the key's grants.
  user.canAccessV1Scaling = key.grantV1Scaling;
  user.canAccessOrderBlock = key.grantOrderBlock;
  user.canAccessEmaCrossover = key.grantEmaCrossover;
  user.canAccessHiddenBullish = key.grantHiddenBullish;
  user.canAccessAlphaSniper = key.grantAlphaSniper;
  user.plan = key.plan as PlanTier;
  user.lastSeenAt = now;

  db.persist();

  return { ok: true, user: toSessionUser(db, user), token: signSession(db, user.id) };
}

export function cookieHeader(token: string, maxAgeSec = SESSION_TTL_MS / 1000): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.round(maxAgeSec)}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export type { Entitlements, Role };
