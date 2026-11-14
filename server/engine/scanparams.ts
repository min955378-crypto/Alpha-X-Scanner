import { getDb } from './db';
import type { ScannerSlug } from '@/lib/types';

/**
 * MODULE 5  Scanner parameter resolution.
 *
 * The Admin Command Center's Scanner Math Tuner writes tuned values into
 * `scannerConfigs.parametersJson`. This module is the single read path used by
 * the quant engine, so a saved tweak takes effect on the very next cycle
 * without a restart.
 *
 * Values are clamped to a sane domain so a typo (0, negative, absurd) can
 * never produce NaN geometry or invert a comparison. If a key is missing we
 * fall back to the institutional factory default.
 */

export interface ScanParams {
  [key: string]: number;
}

/** Factory institutional defaults — exactly the values shipped in the product. */
export const FACTORY: Record<ScannerSlug, ScanParams> = {
  'v1-scaling': {
    rsiMin: 50,
    rsiSweetMin: 52,
    rsiSweetMax: 55,
    rsiMax: 58.5,
    rvolMin: 1.5,
    atrSlMult: 1.2,
    atrTp1Mult: 1.8,
    atrTp2Mult: 3.0,
  },
  'order-block': {
    minAtrWidth: 0.15,
    maxAtrWidth: 1.6,
    rejectionWickPct: 45,
    rvolMin: 1.3,
    maxTouches: 1,
    lookbackSwing: 10,
  },
  'ema-crossover': {
    fastEma: 9,
    midEma: 21,
    slowEma: 50,
    pullbackAtrBand: 0.25,
    rvolMin: 1.25,
  },
  'hidden-bullish': {
    bullRsiMin: 30,
    bullRsiMax: 40,
    bearRsiMin: 60,
    bearRsiMax: 70,
    minSwingBars: 5,
    maxSwingBars: 40,
    rvolMin: 1.2,
  },
  'alpha-sniper': {
    rsiLength: 14,
    emaSmooth: 3,
    lowerBand: 30,
    upperBand: 70,
    fastTrendEma: 13,
    slowTrendEma: 34,
    minWinRate500: 55.0,
    minClosedTrades: 5,
  },
};

/** Per-key sanity domain: [min, max]. */
const DOMAIN: Record<string, [number, number]> = {
  rsiMin: [1, 99],
  rsiSweetMin: [1, 99],
  rsiSweetMax: [1, 99],
  rsiMax: [1, 99],
  rvolMin: [0, 50],
  atrSlMult: [0.1, 20],
  atrTp1Mult: [0.1, 40],
  atrTp2Mult: [0.1, 60],
  minAtrWidth: [0.01, 10],
  maxAtrWidth: [0.02, 20],
  rejectionWickPct: [1, 99],
  maxTouches: [0, 10],
  lookbackSwing: [2, 60],
  fastEma: [2, 400],
  midEma: [2, 400],
  slowEma: [2, 400],
  pullbackAtrBand: [0.01, 5],
  bullRsiMin: [1, 99],
  bullRsiMax: [1, 99],
  bearRsiMin: [1, 99],
  bearRsiMax: [1, 99],
  minSwingBars: [2, 120],
  maxSwingBars: [2, 240],
  rsiLength: [2, 100],
  emaSmooth: [1, 50],
  lowerBand: [1, 99],
  upperBand: [1, 99],
  fastTrendEma: [2, 400],
  slowTrendEma: [2, 400],
  minWinRate500: [0, 100],
  minClosedTrades: [0, 200],
};

function clamp(key: string, v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  const d = DOMAIN[key];
  if (!d) return v;
  return Math.min(d[1], Math.max(d[0], v));
}

/* Resolution is memoised on the config row's `updatedAt`, so the hot scan loop
   pays one Map lookup instead of re-merging objects for every coin × timeframe. */
const cache = new Map<ScannerSlug, { stamp: number; params: ScanParams }>();

export function getScanParams(slug: ScannerSlug): ScanParams {
  const cfg = getDb().scannerConfigs.get(slug);
  const stamp = cfg?.updatedAt ?? 0;
  const hit = cache.get(slug);
  if (hit && hit.stamp === stamp) return hit.params;

  const base = FACTORY[slug];
  const merged: ScanParams = { ...base };
  if (cfg) {
    for (const [k, v] of Object.entries(cfg.parametersJson)) {
      if (typeof v !== 'number') continue;
      const fallback = base[k];
      merged[k] = fallback === undefined ? clamp(k, v, v) : clamp(k, v, fallback);
    }
  }

  /* Order Block: a max zone span narrower than the min would make every zone
     invalid, so keep a one-step separation. */
  if (slug === 'order-block' && merged.maxAtrWidth <= merged.minAtrWidth) {
    merged.maxAtrWidth = merged.minAtrWidth + 0.05;
  }
  /* Hidden Bullish: guard the two RSI windows against inversion. */
  if (slug === 'hidden-bullish') {
    if (merged.bullRsiMax <= merged.bullRsiMin) merged.bullRsiMax = merged.bullRsiMin + 1;
    if (merged.bearRsiMax <= merged.bearRsiMin) merged.bearRsiMax = merged.bearRsiMin + 1;
    if (merged.maxSwingBars <= merged.minSwingBars) merged.maxSwingBars = merged.minSwingBars + 1;
  }
  /* Alpha Sniper bands must stay ordered. */
  if (slug === 'alpha-sniper' && merged.upperBand <= merged.lowerBand) {
    merged.upperBand = merged.lowerBand + 1;
  }

  cache.set(slug, { stamp, params: merged });
  return merged;
}

/** Drop the memo — called after an admin saves a tweak. */
export function invalidateScanParams(): void {
  cache.clear();
}

/**
 * Every EMA period the store must maintain. Always includes the factory set
 * (other scanners and the heatmap read them) plus whatever the admin tuned.
 */
export function requiredEmaPeriods(): number[] {
  const set = new Set<number>([9, 13, 21, 34, 50]);
  const add = (v: number | undefined) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 2 && v <= 400) set.add(Math.round(v));
  };
  const ema = getScanParams('ema-crossover');
  add(ema.fastEma);
  add(ema.midEma);
  add(ema.slowEma);
  const sniper = getScanParams('alpha-sniper');
  add(sniper.fastTrendEma);
  add(sniper.slowTrendEma);
  return [...set].sort((a, b) => a - b);
}
