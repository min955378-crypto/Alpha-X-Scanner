import type { WireFrame } from './wire';

/**
 * §5.1  ZERO-WAIT SNAPSHOT HYDRATION.
 *
 * The terminal must paint within 200 ms of login — long before the engine's
 * 60 s indicator cycle or the WebSocket handshake can possibly complete. So we
 * keep the last known market frame in `localStorage` under
 * `alphax:v2:market_snapshot` and render it synchronously on mount, then let
 * the live stream overwrite it a moment later.
 *
 * The payload is stored ALREADY ENCODED (the compact wire shape from
 * `lib/wire.ts`) and is aggressively trimmed so a 600-coin book stays well
 * inside the ~5 MB localStorage budget.
 */

const KEY = 'alphax:v2:market_snapshot';

/** Snapshots older than this are stale enough to be misleading. */
const MAX_AGE_MS = 15 * 60 * 1000;

/** Hard ceiling on what we will write — protects the origin's storage quota. */
const MAX_BYTES = 2_500_000;

export interface CachedSnapshot {
  savedAt: number;
  timeframe: string;
  frame: WireFrame;
}

function safeGet(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function safeSet(value: string): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* Quota exceeded or private mode — hydration is a nice-to-have, not a
       requirement, so a failure here must never break the terminal. */
  }
}

export function readSnapshot(): CachedSnapshot | null {
  const raw = safeGet();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedSnapshot;
    if (!parsed?.frame || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSnapshot(timeframe: string, frame: WireFrame): void {
  const payload: CachedSnapshot = { savedAt: Date.now(), timeframe, frame };
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return;
  }
  if (serialized.length > MAX_BYTES) return;
  safeSet(serialized);
}

export function clearSnapshot(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
