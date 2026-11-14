'use client';

/**
 * §11.2  Local storage layer with the mandatory idempotent `v1 -> v2`
 * migrator. Runs once on client init and guarantees zero data loss for users
 * upgrading from ScalpPro v1.
 */

export const NS_V1 = 'scalppro:v1';
export const NS_V2 = 'scalppro:v2';

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
