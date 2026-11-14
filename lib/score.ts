import type { ScoreBreakdown, SignalStage } from '@/lib/types';

/**
 * §7.3  Explicit 0–100 signal score point budget.
 *
 * Score = clamp(S_structure + S_volume + S_trend + S_htf + S_rr + S_liquidity − P_risk, 0, 100)
 *
 * Deterministic and integer-valued so the same setup always scores the same
 * on the Heatmap, the Pro Table, Coin Finder and all five scanners (§15.2).
 */

export type HtfAlignment = 'ALIGNED' | 'NEUTRAL' | 'OPPOSING';

export interface ScoreInput {
  scannerSlug: string;
  stage: SignalStage;
  /** Order-Block mitigation count (0 = fresh). Only used by `order-block`. */
  obTouches?: number;
  rvol: number;
  /** EMA9 > EMA21 > EMA50 (long) or EMA9 < EMA21 < EMA50 (short). */
  fullEmaStack: boolean;
  /** EMA9 vs EMA21 aligned only. */
  partialEma: boolean;
  /** Candle body as a fraction of the bar range (0..1). */
  bodyRatio: number;
  htfAlignment: HtfAlignment;
  rr: number;
  quoteVol24h: number;
  spreadPct: number;
  isMonitoringTag: boolean;
}

export function computeScore(input: ScoreInput): ScoreBreakdown {
  /* 1. Primary setup quality — 30 pts. */
  let structure = 0;
  if (input.scannerSlug === 'order-block' && input.obTouches !== undefined) {
    structure = input.obTouches === 0 ? 30 : input.obTouches === 1 ? 18 : 0;
  } else {
    structure = input.stage === 'ENTRY_READY' ? 30 : input.stage === 'WAITING' ? 22 : input.stage === 'POTENTIAL' ? 15 : 0;
  }

  /* 2. Relative volume confirmation — 20 pts. */
  const volume =
    input.rvol >= 2.0 ? 20 : input.rvol >= 1.5 ? 15 : input.rvol >= 1.2 ? 10 : 4;

  /* 3. Momentum / impulse cleanliness — 15 pts. */
  const trend = input.fullEmaStack && input.bodyRatio >= 0.6 ? 15 : input.partialEma ? 9 : 0;

  /* 4. Higher-timeframe alignment — 15 pts. */
  const htf = input.htfAlignment === 'ALIGNED' ? 15 : input.htfAlignment === 'NEUTRAL' ? 7 : 0;

  /* 5. Risk-to-reward — 10 pts. */
  const rr = input.rr >= 2.5 ? 10 : input.rr >= 2.0 ? 8 : input.rr >= 1.5 ? 5 : 0;

  /* 6. Liquidity & spread health — 10 pts. */
  const liquidity =
    input.quoteVol24h >= 20_000_000 && input.spreadPct <= 0.05
      ? 10
      : input.quoteVol24h >= 5_000_000 && input.spreadPct <= 0.08
        ? 5
        : 0;

  /* 7. Risk penalty — −25 pts. */
  const risk = input.isMonitoringTag ? 25 : 0;

  const total = Math.max(0, Math.min(100, structure + volume + trend + htf + rr + liquidity - risk));

  return { structure, volume, trend, htf, rr, liquidity, risk, total };
}

/** §7.3 #4 — next-higher-timeframe trend agreement. */
export function htfAlignment(
  direction: 'LONG' | 'SHORT',
  htfEma21: number,
  htfEma50: number,
  htfRsi: number,
): HtfAlignment {
  const emaAligned = direction === 'LONG' ? htfEma21 > htfEma50 : htfEma21 < htfEma50;
  const rsiSide = direction === 'LONG' ? htfRsi >= 50 : htfRsi < 50;
  if (emaAligned && rsiSide) return 'ALIGNED';
  if (emaAligned || rsiSide) return 'NEUTRAL';
  return 'OPPOSING';
}

/** §7.2 Alpha Sniper — zero-division-safe 500-candle win-rate filter. */
export function alphaSniperWrGate(wr500: number | null, closedTrades500: number): {
  passes: boolean;
  adjustment: number;
  label: string;
} {
  if (closedTrades500 >= 5 && wr500 !== null) {
    return {
      passes: wr500 >= 55,
      adjustment: 0,
      label: `WIN RATE: ${wr500.toFixed(1)}%`,
    };
  }
  // Fewer than 5 closed trades: never divide by zero (§7.2).
  return {
    passes: true,
    adjustment: -10,
    label: closedTrades500 > 0 ? `WIN RATE: -- (<5 trades)` : 'WIN RATE: WARMING UP',
  };
}
