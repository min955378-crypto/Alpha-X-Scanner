'use client';

/**
 * §11.2  Local storage layer with the mandatory idempotent `v1 -> v2`
 * migrator. Runs once on client init and guarantees zero data loss for users
 * upgrading from Alpha X Scanner v1.
 */

export const NS_V1 = 'alpha-x-scanner:v1';
export const NS_V2 = 'alpha-x-scanner:v2';

/* -------------------------------------------------------------------------- */
/* Auth & onboarding keys                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Disclaimer-audit directive §1.4 — unified `alphax:v2:*` keys.
 *
 * NOTE ON `auth_session`: the real session credential is an **http-only
 * cookie** (`alpha_x_session`), which JavaScript cannot read by design. We do
 * NOT mirror it into localStorage — that would hand any XSS the session token.
 * The key below stores only non-sensitive session *metadata* (who was last
 * signed in) so the login screen can prefill the username and the guard can
 * tell "never signed in" from "was signed in, still resolving".
 */
export const NS_AUTH = 'alphax:v2';
export const K_AUTH_SESSION = `${NS_AUTH}:auth_session`;
export const K_DISCLAIMER_GLOBAL = `${NS_AUTH}:disclaimer_accepted`;
/** Alias named in directive §1.4 — kept in lockstep with the flag above. */
export const K_DISCLAIMER_ALIAS = `${NS_AUTH}:disclaimer`;
export const K_DISCLAIMER_DONT_REMIND = `${NS_AUTH}:disclaimer_dont_remind`;

/** Per-account disclaimer acknowledgement, keyed by lowercased username. */
export function disclaimerKey(username: string): string {
  return `${NS_AUTH}:disclaimer:${username.trim().toLowerCase()}`;
}

/** Guard every storage access — Safari private mode throws on access. */
function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Quota exceeded / storage disabled — onboarding falls back to the server flag. */
  }
}

/** True once this account has acknowledged the disclaimer (local mirror). */
export function hasAcceptedDisclaimer(username: string | null | undefined): boolean {
  if (!username) return safeGet(K_DISCLAIMER_GLOBAL) === 'true';
  return (
    safeGet(disclaimerKey(username)) === 'true' ||
    safeGet(K_DISCLAIMER_GLOBAL) === 'true' ||
    safeGet(K_DISCLAIMER_ALIAS) === 'true'
  );
}

/**
 * Record acknowledgement locally. `dontRemind` also sets the global flag so a
 * subsequent account on the same browser is not nagged either.
 */
export function persistDisclaimerAccepted(username: string, dontRemind: boolean): void {
  safeSet(disclaimerKey(username), 'true');
  if (dontRemind) {
    safeSet(K_DISCLAIMER_DONT_REMIND, 'true');
    safeSet(K_DISCLAIMER_GLOBAL, 'true');
    safeSet(K_DISCLAIMER_ALIAS, 'true');
  }
}

/** Non-sensitive session metadata (username only) for prefill and guard hints. */
export function rememberSession(username: string): void {
  safeSet(K_AUTH_SESSION, username.trim().toLowerCase());
}

export function clearRememberedSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(K_AUTH_SESSION);
  } catch {
    /* ignore */
  }
}

export function rememberedSession(): string | null {
  return safeGet(K_AUTH_SESSION);
}

export type StorageKey =
  | 'watchlist'
  | 'timeframe'
  | 'sound'
  | 'presets'
  | 'disclaimer'
  | 'density'
  | 'clock24'
  | 'timezone'
  | 'language'
  | 'chartMode'
  | 'volumeFormat'
  | 'pricePrecision'
  | 'hideMonitoring'
  | 'activeView'
  | 'alertVolume';

const V1_KEYS = ['watchlist', 'timeframe', 'sound', 'presets', 'disclaimer'] as const;

export function migrateV1ToV2(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of V1_KEYS) {
      const legacyVal = window.localStorage.getItem(`${NS_V1}:${key}`);
      if (legacyVal !== null && window.localStorage.getItem(`${NS_V2}:${key}`) === null) {
        window.localStorage.setItem(`${NS_V2}:${key}`, legacyVal);
      }
    }
  } catch {
    /* Storage disabled (private mode) — migration is best-effort. */
  }
}

export function readStore<T>(key: StorageKey, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`${NS_V2}:${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStore<T>(key: StorageKey, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${NS_V2}:${key}`, JSON.stringify(value));
  } catch {
    /* Quota exceeded / disabled — ignore. */
  }
}

export function exportBackup(): string {
  const out: Record<string, unknown> = {};
  if (typeof window === 'undefined') return JSON.stringify(out);
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(NS_V2)) out[k] = window.localStorage.getItem(k);
  }
  return JSON.stringify({ namespace: NS_V2, exportedAt: Date.now(), data: out }, null, 2);
}

export function importBackup(json: string): number {
  const parsed = JSON.parse(json) as { data?: Record<string, string> };
  const data = parsed?.data ?? {};
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(NS_V2) && typeof v === 'string') {
      window.localStorage.setItem(k, v);
      n += 1;
    }
  }
  return n;
}
