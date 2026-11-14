import type { SessionUser } from './types';

/**
 * §2  Access model — ONE license key unlocks 100% of the platform.
 *
 * Scanner tabs are never individually locked any more. The only thing that
 * can gate the terminal is license *status*: a key that is missing, expired
 * or revoked, or an account that has been suspended.
 */

export type LicenseState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'NONE' | 'SUSPENDED';

export interface LicenseStatus {
  state: LicenseState;
  /** True when the terminal — and every scanner — is fully usable. */
  active: boolean;
  expiresAt: number | null;
  msLeft: number | null;
  /** Human countdown, e.g. `6d 14h`, `3h 12m`, `48s`. */
  remaining: string;
  /** Short badge copy for the Top Bar dropdown. */
  badge: string;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Compact countdown used by the "Your access" dropdown and renewal banners. */
export function formatValidity(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'expired';

  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  const s = Math.floor((ms % MINUTE) / 1000);

  if (d >= 365) return 'Lifetime';
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function licenseStatus(user: SessionUser | null, now = Date.now()): LicenseStatus {
  if (!user) {
    return { state: 'NONE', active: false, expiresAt: null, msLeft: null, remaining: '—', badge: 'No session' };
  }
  if (user.isSuspended) {
    return {
      state: 'SUSPENDED',
      active: false,
      expiresAt: user.licenseExpiresAt,
      msLeft: null,
      remaining: '—',
      badge: 'Suspended',
    };
  }

  const expiresAt = user.licenseExpiresAt;
  const msLeft = expiresAt === null ? null : expiresAt - now;

  if (msLeft === null) {
    return {
      state: 'NONE',
      active: false,
      expiresAt: null,
      msLeft: null,
      remaining: '—',
      badge: 'No license bound',
    };
  }
  if (msLeft <= 0) {
    return {
      state: 'EXPIRED',
      active: false,
      expiresAt,
      msLeft: 0,
      remaining: 'expired',
      badge: 'Expired',
    };
  }

  const remaining = formatValidity(msLeft);
  const state: LicenseState = msLeft < 3 * DAY ? 'EXPIRING' : 'ACTIVE';
  return {
    state,
    active: true,
    expiresAt,
    msLeft,
    remaining,
    badge: state === 'EXPIRING' ? `Expires in ${remaining}` : `Active · ${remaining} left`,
  };
}

/**
 * §2.3  Display label for the internal plan tier. The persisted enum stays
 * `LITE | ULTRA_PRO` so existing snapshots keep loading, but every user-facing
 * surface reads `Alpha X Pro` — the legacy tier name is never shown again.
 */
export const PLAN_LABEL = 'Alpha X Pro';

export function planLabel(): string {
  return PLAN_LABEL;
}

/**
 * §2.3  Every scanner is unlocked by an active key. Kept as an explicit helper
 * (rather than reading the entitlement flags directly) so the "one key unlocks
 * everything" rule lives in exactly one place.
 */
export function scannerUnlocked(): boolean {
  return true;
}
