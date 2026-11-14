import { bodyRatio, candleRange, emaNext, lowerWickRatio, upperWickRatio } from '@/lib/indicators';
import {
  SCANNERS,
  TF_NEXT_UP,
  type CoinSnapshot,
  type ScannerSignal,
  type ScannerSlug,
  type SignalDirection,
  type SignalStage,
  type Timeframe,
} from '@/lib/types';
import { alphaSniperWrGate, computeScore, htfAlignment } from '@/lib/score';
import { MarketStore, SymbolState, TfAnalysis } from './store';
import { getScanParams, type ScanParams } from './scanparams';

/**
 * §7.2  Canonical long/short math for all five scanners.
 *
 * Runs ONCE per 60s cycle inside the Global Quant Worker — never per user.
 * Clicking [▶ Start] only subscribes a WebSocket session to the resulting
 * Redis-equivalent pub/sub channel (§2.3).
 */

export interface ScanContext {
  st: SymbolState;
  tf: Timeframe;
  htf: Timeframe;
  now: number;
  snap: CoinSnapshot;
  htfSnap: CoinSnapshot;
  a: TfAnalysis;
  htfA: TfAnalysis;
  /** MODULE 5  Live parameters from the Admin Math Tuner (clamped + defaults). */
  P: ScanParams;
  /** MODULE 5  Intrabar EMA for an arbitrary (admin-tuned) period. */
  liveEma: (period: number) => number;
}

const VALID_MS = 30 * 60 * 1000;

type Draft = {
  direction: SignalDirection;
  stage: SignalStage;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  reasons: string[];
  obTouches?: number;
};

function rrOf(direction: SignalDirection, entry: number, sl: number, tp1: number): number {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp1 - entry);
  return risk <= 0 ? 0 : reward / risk;
}

function finalize(
  slug: ScannerSlug,
  ctx: ScanContext,
  d: Draft,
): ScannerSignal {
  const { snap, htfSnap } = ctx;
  const dir = d.direction;
  const long = dir === 'LONG';

  const fullEmaStack = long
    ? snap.ema9 > snap.ema21 && snap.ema21 > snap.ema50
    : snap.ema9 < snap.ema21 && snap.ema21 < snap.ema50;
  const partialEma = long ? snap.ema9 > snap.ema21 : snap.ema9 < snap.ema21;

  const forming = ctx.a.candles.length > 0 ? ctx.st.tf[ctx.tf].candles[ctx.st.tf[ctx.tf].candles.length - 1] : null;
  const br = forming ? bodyRatio(forming) : 0;

  let breakdown = computeScore({
    scannerSlug: slug,
    stage: d.stage,
    obTouches: d.obTouches,
    rvol: snap.rvol,
    fullEmaStack,
    partialEma,
    bodyRatio: br,
    htfAlignment: htfAlignment(dir, htfSnap.ema21, htfSnap.ema50, htfSnap.rsi),
    rr: rrOf(dir, d.entry, d.sl, d.tp1),
    quoteVol24h: snap.quoteVol24h,
    spreadPct: snap.spreadPct,
    isMonitoringTag: snap.isMonitoringTag,
  });

  const reasons = [...d.reasons];

  // §7.2 #5  Alpha Sniper zero-division-safe win-rate gate.
  if (slug === 'alpha-sniper') {
    const gate = alphaSniperWrGate(
      snap.wr500,
      snap.closedTrades500,
      ctx.P.minWinRate500,
      Math.round(ctx.P.minClosedTrades),
    );
    reasons.push(gate.label);
    if (gate.adjustment !== 0) {
      breakdown = {
        ...breakdown,
        total: Math.max(0, Math.min(100, breakdown.total + gate.adjustment)),
      };
    }
  }

  return {
    id: `${slug}:${snap.symbol}:${ctx.tf}:${dir}`,
    scannerSlug: slug,
    symbol: snap.symbol,
    baseAsset: snap.baseAsset,
    timeframe: ctx.tf,
    direction: dir,
    stage: d.stage,
    score: breakdown.total,
    scoreBreakdown: breakdown,
    entryPrice: d.entry,
    invalidationPrice: d.sl,
    tp1Price: d.tp1,
    tp2Price: d.tp2,
    rrRatio: Math.round(rrOf(dir, d.entry, d.sl, d.tp1) * 100) / 100,
    rsiValue: Math.round(snap.rsi * 10) / 10,
    rvolValue: Math.round(snap.rvol * 100) / 100,
    reasons,
    isMonitoringTag: snap.isMonitoringTag,
    createdAt: ctx.now,
    validUntil: ctx.now + VALID_MS,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. ⚡ V1 Scaling (sidebar: "V1 Scalping")                                   */
/* -------------------------------------------------------------------------- */

function v1Scaling(ctx: ScanContext): ScannerSignal[] {
  const { snap, a, P } = ctx;
  const slMult = P.atrSlMult;
  const tp1Mult = P.atrTp1Mult;
  const tp2Mult = P.atrTp2Mult;
  /* The POTENTIAL stage has always used a softer 1.25× RVOL floor than the
     1.50× confirmation gate; keep that 5/6 ratio so tuning rvolMin scales the
     whole ladder without changing the factory behaviour. */
  const rvolSoft = P.rvolMin * (5 / 6);
  const shortBandLo = P.rsiSweetMin + (P.rsiSweetMax - P.rsiSweetMin) / 3;
  const shortBandHi = P.rsiMin - (P.rsiMin - shortBandLo) / 3;
  const prevBar = a.candles[a.candles.length - 1];
  if (!prevBar) return [];
  const c = snap.price;
  const out: ScannerSignal[] = [];

  /* ------------------------------- LONG ---------------------------------- */
  if (snap.rsi >= P.rsiMin && snap.rsi < P.rsiSweetMin && snap.rsiDelta > 0 && c > snap.ema50 && snap.rvol >= rvolSoft) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'LONG',
        stage: 'POTENTIAL',
        entry: c,
        sl: c - slMult * snap.atr,
        tp1: c + tp1Mult * snap.atr,
        tp2: c + tp2Mult * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} entering the ${P.rsiMin}–${P.rsiSweetMin} momentum shelf`,
          `RSI rising (+${snap.rsiDelta.toFixed(2)} in the last cycle)`,
          `Price above EMA50`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ ${rvolSoft.toFixed(2)}×`,
        ],
      }),
    );
  } else if (
    snap.rsi >= P.rsiSweetMin &&
    snap.rsi <= P.rsiSweetMax &&
    c > snap.ema21 &&
    snap.ema21 > snap.ema50 &&
    Math.abs(c - prevBar.h) / prevBar.h <= 0.003
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'LONG',
        stage: 'WAITING',
        entry: c,
        sl: c - slMult * snap.atr,
        tp1: c + tp1Mult * snap.atr,
        tp2: c + tp2Mult * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} inside the ${P.rsiSweetMin}–${P.rsiSweetMax} rising sweet spot`,
          `Price within 0.3% of the prior bar high (${prevBar.h.toPrecision(6)})`,
          `EMA21 > EMA50 stacked`,
        ],
      }),
    );
  } else if (
    snap.rsi >= P.rsiSweetMin &&
    snap.rsi <= P.rsiMax &&
    c > prevBar.h &&
    snap.ema9 > snap.ema21 &&
    snap.ema21 > snap.ema50 &&
    snap.rvol >= P.rvolMin
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'LONG',
        stage: 'ENTRY_READY',
        entry: c,
        sl: c - slMult * snap.atr,
        tp1: c + tp1Mult * snap.atr,
        tp2: c + tp2Mult * snap.atr,
        reasons: [
          `Broke the prior bar high — breakout confirmed`,
          `RSI ${snap.rsi.toFixed(1)} in the ${P.rsiSweetMin}–${P.rsiMax} trigger band`,
          `EMA9 > EMA21 > EMA50 full stack`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ ${P.rvolMin.toFixed(2)}×`,
        ],
      }),
    );
  }

  /* ------------------------------- SHORT --------------------------------- */
  if (snap.rsi > 100 - P.rsiSweetMin && snap.rsi <= 100 - P.rsiMin && snap.rsiDelta < 0 && c < snap.ema50 && snap.rvol >= rvolSoft) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'SHORT',
        stage: 'POTENTIAL',
        entry: c,
        sl: c + slMult * snap.atr,
        tp1: c - tp1Mult * snap.atr,
        tp2: c - tp2Mult * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} rolling off the ${100 - P.rsiMin} line`,
          `RSI falling (${snap.rsiDelta.toFixed(2)} this cycle)`,
          `Price below EMA50`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ ${rvolSoft.toFixed(2)}×`,
        ],
      }),
    );
  } else if (
    snap.rsi >= 100 - P.rsiSweetMax &&
    snap.rsi <= 100 - P.rsiSweetMin &&
    c < snap.ema21 &&
    snap.ema21 < snap.ema50 &&
    Math.abs(c - prevBar.l) / prevBar.l <= 0.003
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'SHORT',
        stage: 'WAITING',
        entry: c,
        sl: c + slMult * snap.atr,
        tp1: c - tp1Mult * snap.atr,
        tp2: c - tp2Mult * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} inside the ${100 - P.rsiSweetMax}–${100 - P.rsiSweetMin} falling band`,
          `Price within 0.3% of the prior bar low`,
          `EMA21 < EMA50 stacked`,
        ],
      }),
    );
  } else if (
    snap.rsi >= 100 - P.rsiMax &&
    snap.rsi <= shortBandHi &&
    c < prevBar.l &&
    snap.ema9 < snap.ema21 &&
    snap.ema21 < snap.ema50 &&
    snap.rvol >= P.rvolMin
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'SHORT',
        stage: 'ENTRY_READY',
        entry: c,
        sl: c + slMult * snap.atr,
        tp1: c - tp1Mult * snap.atr,
        tp2: c - tp2Mult * snap.atr,
        reasons: [
          `Lost the prior bar low — breakdown confirmed`,
          `RSI ${snap.rsi.toFixed(1)} in the ${(100 - P.rsiMax).toFixed(1)}–${shortBandHi.toFixed(1)} trigger band`,
          `EMA9 < EMA21 < EMA50 full stack`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ ${P.rvolMin.toFixed(2)}×`,
        ],
      }),
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* 2. 🟩 Order Block                                                           */
/* -------------------------------------------------------------------------- */

function orderBlock(ctx: ScanContext): ScannerSignal[] {
  const { snap, a, st, tf, P } = ctx;
  const nearAtr = P.minAtrWidth;
  const minWick = P.rejectionWickPct / 100;
  const ob = a.ob;
  if (!ob || !snap.atr) return [];

  const forming = st.tf[tf].candles[st.tf[tf].candles.length - 1];
  const c = snap.price;
  const zoneMid = (ob.hi + ob.lo) / 2;
  const distPct = ((c - zoneMid) / zoneMid) * 100;
  const inside = c >= ob.lo && c <= ob.hi;
  const nearBoundary = Math.min(Math.abs(c - ob.lo), Math.abs(c - ob.hi)) <= nearAtr * snap.atr;
  const wick = ob.type === 'DEMAND' ? lowerWickRatio(forming) : upperWickRatio(forming);

  const base = {
    entry: zoneMid,
    sl: ob.type === 'DEMAND' ? ob.lo - 0.25 * snap.atr : ob.hi + 0.25 * snap.atr,
    tp1: ob.type === 'DEMAND' ? a.swingHigh20 : a.swingLow20,
    obTouches: ob.touches,
  };
  const tp2 =
    ob.type === 'DEMAND'
      ? base.entry + 2.5 * Math.abs(base.entry - base.sl)
      : base.entry - 2.5 * Math.abs(base.entry - base.sl);

  const direction: SignalDirection = ob.type === 'DEMAND' ? 'LONG' : 'SHORT';
  const label = ob.type === 'DEMAND' ? 'Bullish Demand' : 'Bearish Supply';

  let stage: SignalStage | null = null;
  const reasons: string[] = [
    `${label} order block [${ob.lo.toPrecision(6)} – ${ob.hi.toPrecision(6)}]`,
    `${ob.touches === 0 ? 'Fresh — never mitigated' : 'Tested once'}`,
    `Validated by BOS + Fair Value Gap`,
  ];

  if (inside && wick >= minWick && snap.rvol >= P.rvolMin) {
    stage = 'ENTRY_READY';
    reasons.push(`Rejection wick ${(wick * 100).toFixed(0)}% of the bar range ≥ ${P.rejectionWickPct}%`);
    reasons.push(`RVOL ${snap.rvol.toFixed(2)}× ≥ ${P.rvolMin.toFixed(2)}×`);
  } else if (nearBoundary) {
    stage = 'WAITING';
    reasons.push(`Price within ${P.minAtrWidth}×ATR of the zone boundary`);
  } else if (Math.abs(distPct) <= 2.0) {
    stage = 'POTENTIAL';
    reasons.push(`Unmitigated zone ${Math.abs(distPct).toFixed(2)}% away`);
  }

  if (!stage) return [];

  return [
    finalize('order-block', ctx, {
      direction,
      stage,
      entry: base.entry,
      sl: base.sl,
      tp1: base.tp1,
      tp2,
      obTouches: ob.touches,
      reasons,
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* 3. 📈 EMA Crossover                                                        */
/* -------------------------------------------------------------------------- */

function emaCrossover(ctx: ScanContext): ScannerSignal[] {
  const { snap, a, st, tf, P, liveEma } = ctx;
  const emaP = P;
  const c = snap.price;

  /* MODULE 5  Fast/mid/slow periods come from the Admin Math Tuner. */
  const fast = Math.round(P.fastEma);
  const mid = Math.round(P.midEma);
  const slow = Math.round(P.slowEma);
  const fastLive = liveEma(fast);
  const midLive = liveEma(mid);
  const slowLive = liveEma(slow);

  // Live (intrabar) EMA values vs the values confirmed at the last close.
  const closedEma9 = a.ema[fast] ?? fastLive;
  const closedEma21 = a.ema[mid] ?? midLive;
  const closedEma50 = a.ema[slow] ?? slowLive;

  const crossedUp = closedEma9 <= closedEma21 && fastLive > midLive;
  const crossedDown = closedEma9 >= closedEma21 && fastLive < midLive;
  const testingEma21 = Math.abs(c - midLive) <= P.pullbackAtrBand * snap.atr;

  const nearHigh = snap.high24h > 0 && Math.abs(c - snap.high24h) / snap.high24h <= 0.01;
  const nearLow = snap.low24h > 0 && Math.abs(c - snap.low24h) / snap.low24h <= 0.01;

  const out: ScannerSignal[] = [];
  const levels = (dir: SignalDirection) => ({
    entry: c,
    sl: dir === 'LONG' ? snap.ema50 - 0.3 * snap.atr : snap.ema50 + 0.3 * snap.atr,
    tp1: dir === 'LONG' ? c + 1.5 * snap.atr : c - 1.5 * snap.atr,
    tp2: dir === 'LONG' ? c + 2.8 * snap.atr : c - 2.8 * snap.atr,
  });

  if (crossedUp || (fastLive > midLive && midLive > slowLive && closedEma9 > closedEma21 && closedEma21 > closedEma50)) {
    if (snap.rvol >= emaP.rvolMin && !nearHigh) {
      out.push(
        finalize('ema-crossover', ctx, {
          direction: 'LONG',
          stage: 'ENTRY_READY',
          ...levels('LONG'),
          reasons: [
            crossedUp ? `Fresh EMA${fast} × EMA${mid} crossover` : 'EMA stack confirmed on the last close',
            `EMA${fast} > EMA${mid} > EMA${slow}`,
            `RVOL ${snap.rvol.toFixed(2)}× ≥ ${emaP.rvolMin.toFixed(2)}×`,
            'Not extended into the 24h high',
          ],
        }),
      );
    }
  } else if (crossedUp || testingEma21) {
    out.push(
      finalize('ema-crossover', ctx, {
        direction: 'LONG',
        stage: 'WAITING',
        ...levels('LONG'),
        reasons: crossedUp
            ? ['Intrabar EMA9 × EMA21 crossover']
            : [`Price testing EMA21 (±${emaP.pullbackAtrBand}×ATR)`],
      }),
    );
  } else if (Math.abs(fastLive - midLive) <= 0.2 * snap.atr || (fastLive > midLive && midLive > slowLive && testingEma21)) {
    out.push(
      finalize('ema-crossover', ctx, {
        direction: 'LONG',
        stage: 'POTENTIAL',
        ...levels('LONG'),
        reasons: [`EMA${fast} coiling within 0.20×ATR of EMA${mid}`, 'Uptrend stack intact, awaiting the cross'],
      }),
    );
  }

  if (crossedDown || (fastLive < midLive && midLive < slowLive && closedEma9 < closedEma21 && closedEma21 < closedEma50)) {
    if (snap.rvol >= emaP.rvolMin && !nearLow) {
      out.push(
        finalize('ema-crossover', ctx, {
          direction: 'SHORT',
          stage: 'ENTRY_READY',
          ...levels('SHORT'),
          reasons: [
            crossedDown ? `Fresh EMA${fast} × EMA${mid} crossunder` : 'EMA stack confirmed on the last close',
            `EMA${fast} < EMA${mid} < EMA${slow}`,
            `RVOL ${snap.rvol.toFixed(2)}× ≥ ${emaP.rvolMin.toFixed(2)}×`,
            'Not extended into the 24h low',
          ],
        }),
      );
    }
  } else if (crossedDown || testingEma21) {
    out.push(
      finalize('ema-crossover', ctx, {
        direction: 'SHORT',
        stage: 'WAITING',
        ...levels('SHORT'),
        reasons: crossedDown
            ? ['Intrabar EMA9 × EMA21 crossunder']
            : [`Price testing EMA21 (±${emaP.pullbackAtrBand}×ATR)`],
      }),
    );
  } else if (Math.abs(fastLive - midLive) <= 0.2 * snap.atr || (fastLive < midLive && midLive < slowLive && testingEma21)) {
    out.push(
      finalize('ema-crossover', ctx, {
        direction: 'SHORT',
        stage: 'POTENTIAL',
        ...levels('SHORT'),
        reasons: [`EMA${fast} coiling within 0.20×ATR of EMA${mid}`, 'Downtrend stack intact, awaiting the cross'],
      }),
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* 4. 🔵 Hidden Bullish                                                       */
/* -------------------------------------------------------------------------- */

function hiddenBullish(ctx: ScanContext): ScannerSignal[] {
  const { snap, a, P } = ctx;
  const hb = a.hb;
  if (!hb) return [];
  const c = snap.price;

  const levels = (dir: SignalDirection) => ({
    entry: c,
    sl: dir === 'LONG' ? c - 1.0 * snap.atr : c + 1.0 * snap.atr,
    tp1: dir === 'LONG' ? c + 1.8 * snap.atr : c - 1.8 * snap.atr,
    tp2: dir === 'LONG' ? c + 3.0 * snap.atr : c - 3.0 * snap.atr,
  });

  if (hb.type === 'BULL') {
    const brokeMss = c > hb.mss;
    const rsiTurned = snap.rsi >= snap.rsiPrev + 1.5;
    if (brokeMss && c > snap.ema9 && snap.rvol >= P.rvolMin) {
      return [
        finalize('hidden-bullish', ctx, {
          direction: 'LONG',
          stage: 'ENTRY_READY',
          ...levels('LONG'),
          reasons: [
            'Price closed above the micro-swing high (MSS break)',
            `Hidden bullish divergence: higher low + lower RSI low at ${hb.rsiAtT2.toFixed(1)}`,
            'Price above EMA9',
            `RVOL ${snap.rvol.toFixed(2)}× ≥ ${P.rvolMin.toFixed(2)}×`,
          ],
        }),
      ];
    }
    if (rsiTurned) {
      return [
        finalize('hidden-bullish', ctx, {
          direction: 'LONG',
          stage: 'WAITING',
          ...levels('LONG'),
          reasons: [
            `RSI turning up (+${snap.rsiDelta.toFixed(2)} this cycle)`,
            `Approaching MSS level ${hb.mss.toPrecision(6)}`,
          ],
        }),
      ];
    }
    return [
      finalize('hidden-bullish', ctx, {
        direction: 'LONG',
        stage: 'POTENTIAL',
        ...levels('LONG'),
        reasons: [
          `Hidden bullish divergence detected in the RSI ${P.bullRsiMin}–${P.bullRsiMax} zone`,
          `Swing low ${hb.t1} → ${hb.t2} formed a higher low`,
        ],
      }),
    ];
  }

  const brokeMss = c < hb.mss;
  const rsiTurned = snap.rsi <= snap.rsiPrev - 1.5;
  if (brokeMss && c < snap.ema9 && snap.rvol >= P.rvolMin) {
    return [
      finalize('hidden-bullish', ctx, {
        direction: 'SHORT',
        stage: 'ENTRY_READY',
        ...levels('SHORT'),
        reasons: [
          'Price closed below the micro-swing low (MSS break)',
          `Hidden bearish divergence: lower high + higher RSI high at ${hb.rsiAtT2.toFixed(1)}`,
          'Price below EMA9',
          `RVOL ${snap.rvol.toFixed(2)}× ≥ ${P.rvolMin.toFixed(2)}×`,
        ],
      }),
    ];
  }
  if (rsiTurned) {
    return [
      finalize('hidden-bullish', ctx, {
        direction: 'SHORT',
        stage: 'WAITING',
        ...levels('SHORT'),
        reasons: [`RSI turning down (${snap.rsiDelta.toFixed(2)} this cycle)`, `Approaching MSS level ${hb.mss.toPrecision(6)}`],
      }),
    ];
  }
  return [
    finalize('hidden-bullish', ctx, {
      direction: 'SHORT',
      stage: 'POTENTIAL',
      ...levels('SHORT'),
      reasons: [
        `Hidden bearish divergence detected in the RSI ${P.bearRsiMin}–${P.bearRsiMax} zone`,
        `Swing high ${hb.t1} → ${hb.t2} formed a lower high`,
      ],
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* 5. 🎯 Alpha Sniper                                                         */
/* -------------------------------------------------------------------------- */

function alphaSniper(ctx: ScanContext): ScannerSignal[] {
  const { snap, st, tf, P, liveEma } = ctx;
  const forming = st.tf[tf].candles[st.tf[tf].candles.length - 1];
  const a = snap.alphaSniper;
  const aPrev = snap.alphaSniperPrev;
  const c = snap.price;
  const out: ScannerSignal[] = [];

  const levels = (dir: SignalDirection) => ({
    entry: c,
    sl: dir === 'LONG' ? c - 1.0 * snap.atr : c + 1.0 * snap.atr,
    tp1: dir === 'LONG' ? c + 1.5 * snap.atr : c - 1.5 * snap.atr,
    tp2: dir === 'LONG' ? c + 3.0 * snap.atr : c - 3.0 * snap.atr,
  });

  const loBand = P.lowerBand;
  const hiBand = P.upperBand;
  const midBand = (P.lowerBand + P.upperBand) / 2;
  const crossUp30 = aPrev <= loBand && a > loBand;
  const crossUp50 = aPrev <= midBand && a > midBand;
  const crossDown70 = aPrev >= hiBand && a < hiBand;
  const crossDown50 = aPrev >= midBand && a < midBand;

  /* LONG */
  const fastTrend = liveEma(Math.round(P.fastTrendEma));
  const slowTrend = liveEma(Math.round(P.slowTrendEma));

  if ((crossUp30 || crossUp50) && fastTrend >= slowTrend && c > forming.o) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'LONG',
        stage: 'ENTRY_READY',
        ...levels('LONG'),
        reasons: [
          `Alpha Sniper crossed ${crossUp30 ? loBand.toFixed(1) : midBand.toFixed(1)} upward (${a.toFixed(1)})`,
          `EMA${Math.round(P.fastTrendEma)} ≥ EMA${Math.round(P.slowTrendEma)} alignment`,
          'Bullish candle body',
        ],
      }),
    );
  } else if (crossUp30) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'LONG',
        stage: 'WAITING',
        ...levels('LONG'),
        reasons: [`Alpha Sniper crossing ${loBand} upward`, 'Awaiting trend-EMA alignment'],
      }),
    );
  } else if (a < loBand + (midBand - loBand) / 6 && a > aPrev) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'LONG',
        stage: 'POTENTIAL',
        ...levels('LONG'),
        reasons: [
          `Alpha Sniper ${a.toFixed(1)} curling up below ${(loBand + (midBand - loBand) / 6).toFixed(1)}`,
          'Channel extreme forming',
        ],
      }),
    );
  }

  /* SHORT */
  if ((crossDown70 || crossDown50) && fastTrend <= slowTrend && c < forming.o) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'SHORT',
        stage: 'ENTRY_READY',
        ...levels('SHORT'),
        reasons: [
          `Alpha Sniper crossed ${crossDown70 ? hiBand.toFixed(1) : midBand.toFixed(1)} downward (${a.toFixed(1)})`,
          `EMA${Math.round(P.fastTrendEma)} ≤ EMA${Math.round(P.slowTrendEma)} alignment`,
          'Bearish candle body',
        ],
      }),
    );
  } else if (crossDown70) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'SHORT',
        stage: 'WAITING',
        ...levels('SHORT'),
        reasons: [`Alpha Sniper crossing ${hiBand} downward`, 'Awaiting trend-EMA alignment'],
      }),
    );
  } else if (a > hiBand - (hiBand - midBand) / 6 && a < aPrev) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'SHORT',
        stage: 'POTENTIAL',
        ...levels('SHORT'),
        reasons: [
          `Alpha Sniper ${a.toFixed(1)} curling down above ${(hiBand - (hiBand - midBand) / 6).toFixed(1)}`,
          'Channel extreme forming',
        ],
      }),
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                     */
/* -------------------------------------------------------------------------- */

const IMPL: Record<ScannerSlug, (ctx: ScanContext) => ScannerSignal[]> = {
  'v1-scaling': v1Scaling,
  'order-block': orderBlock,
  'ema-crossover': emaCrossover,
  'hidden-bullish': hiddenBullish,
  'alpha-sniper': alphaSniper,
};

/** Minimum 24h quote volume for a coin to be scanner-eligible (noise floor). */
const MIN_QUOTE_VOL = 2_000_000;

export function runScanner(
  slug: ScannerSlug,
  store: MarketStore,
  tf: Timeframe,
  now: number,
  cycleId: number,
  limit = 40,
): ScannerSignal[] {
  const signals: ScannerSignal[] = [];
  const htf = TF_NEXT_UP[tf];

  for (const st of store.symbols.values()) {
    if (!st.enabled || !st.tf[tf]) continue;
    const snap = store.snapshot(st, tf, now, cycleId);
    if (snap.quoteVol24h < MIN_QUOTE_VOL) continue;
    const htfSnap = store.snapshot(st, htf, now, cycleId);
    const a = store.getAnalysis(st, tf);
    const htfA = store.getAnalysis(st, htf);
    const ctx: ScanContext = {
      st,
      tf,
      htf,
      now,
      snap,
      htfSnap,
      a,
      htfA,
      P: getScanParams(slug),
      liveEma: (period: number) => store.liveEma(st, tf, period),
    };
    try {
      signals.push(...IMPL[slug](ctx));
    } catch {
      /* One bad symbol must never take down the 60s cycle. */
    }
  }

  // Best-first: entry-ready setups, then score, then liquidity.
  const stageRank: Record<SignalStage, number> = { ENTRY_READY: 0, WAITING: 1, POTENTIAL: 2, EXPIRED: 3, INVALIDATED: 4 };
  signals.sort((x, y) => {
    const s = stageRank[x.stage] - stageRank[y.stage];
    if (s !== 0) return s;
    if (y.score !== x.score) return y.score - x.score;
    return y.rvolValue - x.rvolValue;
  });

  return signals.slice(0, limit);
}

export { SCANNERS };
