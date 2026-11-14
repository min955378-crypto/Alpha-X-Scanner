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
    const gate = alphaSniperWrGate(snap.wr500, snap.closedTrades500);
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
  const { snap, a } = ctx;
  const prevBar = a.candles[a.candles.length - 1];
  if (!prevBar) return [];
  const c = snap.price;
  const out: ScannerSignal[] = [];

  /* ------------------------------- LONG ---------------------------------- */
  if (snap.rsi >= 50 && snap.rsi < 52 && snap.rsiDelta > 0 && c > snap.ema50 && snap.rvol >= 1.25) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'LONG',
        stage: 'POTENTIAL',
        entry: c,
        sl: c - 1.2 * snap.atr,
        tp1: c + 1.8 * snap.atr,
        tp2: c + 3.0 * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} entering the 50–52 momentum shelf`,
          `RSI rising (+${snap.rsiDelta.toFixed(2)} in the last cycle)`,
          `Price above EMA50`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.25×`,
        ],
      }),
    );
  } else if (
    snap.rsi >= 52 &&
    snap.rsi <= 55 &&
    c > snap.ema21 &&
    snap.ema21 > snap.ema50 &&
    Math.abs(c - prevBar.h) / prevBar.h <= 0.003
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'LONG',
        stage: 'WAITING',
        entry: c,
        sl: c - 1.2 * snap.atr,
        tp1: c + 1.8 * snap.atr,
        tp2: c + 3.0 * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} inside the 52–55 rising sweet spot`,
          `Price within 0.3% of the prior bar high (${prevBar.h.toPrecision(6)})`,
          `EMA21 > EMA50 stacked`,
        ],
      }),
    );
  } else if (
    snap.rsi >= 52.5 &&
    snap.rsi <= 58.5 &&
    c > prevBar.h &&
    snap.ema9 > snap.ema21 &&
    snap.ema21 > snap.ema50 &&
    snap.rvol >= 1.5
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'LONG',
        stage: 'ENTRY_READY',
        entry: c,
        sl: c - 1.2 * snap.atr,
        tp1: c + 1.8 * snap.atr,
        tp2: c + 3.0 * snap.atr,
        reasons: [
          `Broke the prior bar high — breakout confirmed`,
          `RSI ${snap.rsi.toFixed(1)} in the 52.5–58.5 trigger band`,
          `EMA9 > EMA21 > EMA50 full stack`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.50×`,
        ],
      }),
    );
  }

  /* ------------------------------- SHORT --------------------------------- */
  if (snap.rsi > 48 && snap.rsi <= 50 && snap.rsiDelta < 0 && c < snap.ema50 && snap.rvol >= 1.25) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'SHORT',
        stage: 'POTENTIAL',
        entry: c,
        sl: c + 1.2 * snap.atr,
        tp1: c - 1.8 * snap.atr,
        tp2: c - 3.0 * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} rolling off the 50 line`,
          `RSI falling (${snap.rsiDelta.toFixed(2)} this cycle)`,
          `Price below EMA50`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.25×`,
        ],
      }),
    );
  } else if (
    snap.rsi >= 45 &&
    snap.rsi <= 48 &&
    c < snap.ema21 &&
    snap.ema21 < snap.ema50 &&
    Math.abs(c - prevBar.l) / prevBar.l <= 0.003
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'SHORT',
        stage: 'WAITING',
        entry: c,
        sl: c + 1.2 * snap.atr,
        tp1: c - 1.8 * snap.atr,
        tp2: c - 3.0 * snap.atr,
        reasons: [
          `RSI ${snap.rsi.toFixed(1)} inside the 45–48 falling band`,
          `Price within 0.3% of the prior bar low`,
          `EMA21 < EMA50 stacked`,
        ],
      }),
    );
  } else if (
    snap.rsi >= 41.5 &&
    snap.rsi <= 47.5 &&
    c < prevBar.l &&
    snap.ema9 < snap.ema21 &&
    snap.ema21 < snap.ema50 &&
    snap.rvol >= 1.5
  ) {
    out.push(
      finalize('v1-scaling', ctx, {
        direction: 'SHORT',
        stage: 'ENTRY_READY',
        entry: c,
        sl: c + 1.2 * snap.atr,
        tp1: c - 1.8 * snap.atr,
        tp2: c - 3.0 * snap.atr,
        reasons: [
          `Lost the prior bar low — breakdown confirmed`,
          `RSI ${snap.rsi.toFixed(1)} in the 41.5–47.5 trigger band`,
          `EMA9 < EMA21 < EMA50 full stack`,
          `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.50×`,
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
  const { snap, a, st, tf } = ctx;
  const ob = a.ob;
  if (!ob || !snap.atr) return [];

  const forming = st.tf[tf].candles[st.tf[tf].candles.length - 1];
  const c = snap.price;
  const zoneMid = (ob.hi + ob.lo) / 2;
  const distPct = ((c - zoneMid) / zoneMid) * 100;
  const inside = c >= ob.lo && c <= ob.hi;
  const nearBoundary = Math.min(Math.abs(c - ob.lo), Math.abs(c - ob.hi)) <= 0.15 * snap.atr;
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

  if (inside && wick >= 0.45 && snap.rvol >= 1.3) {
    stage = 'ENTRY_READY';
    reasons.push(`Rejection wick ${(wick * 100).toFixed(0)}% of the bar range ≥ 45%`);
    reasons.push(`RVOL ${snap.rvol.toFixed(2)}× ≥ 1.30×`);
  } else if (nearBoundary) {
    stage = 'WAITING';
    reasons.push(`Price within 0.15×ATR of the zone boundary`);
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
  const { snap, a, st, tf } = ctx;
  const c = snap.price;

  // Live (intrabar) EMA values vs the values confirmed at the last close.
  const closedEma9 = a.ema[9];
  const closedEma21 = a.ema[21];
  const closedEma50 = a.ema[50];

  const crossedUp = closedEma9 <= closedEma21 && snap.ema9 > snap.ema21;
  const crossedDown = closedEma9 >= closedEma21 && snap.ema9 < snap.ema21;
  const testingEma21 = Math.abs(c - snap.ema21) <= 0.25 * snap.atr;

  const nearHigh = snap.high24h > 0 && Math.abs(c - snap.high24h) / snap.high24h <= 0.01;
  const nearLow = snap.low24h > 0 && Math.abs(c - snap.low24h) / snap.low24h <= 0.01;

  const out: ScannerSignal[] = [];
  const levels = (dir: SignalDirection) => ({
    entry: c,
    sl: dir === 'LONG' ? snap.ema50 - 0.3 * snap.atr : snap.ema50 + 0.3 * snap.atr,
    tp1: dir === 'LONG' ? c + 1.5 * snap.atr : c - 1.5 * snap.atr,
    tp2: dir === 'LONG' ? c + 2.8 * snap.atr : c - 2.8 * snap.atr,
  });

  if (crossedUp || (snap.ema9 > snap.ema21 && snap.ema21 > snap.ema50 && closedEma9 > closedEma21 && closedEma21 > closedEma50)) {
    if (snap.rvol >= 1.25 && !nearHigh) {
      out.push(
        finalize('ema-crossover', ctx, {
          direction: 'LONG',
          stage: 'ENTRY_READY',
          ...levels('LONG'),
          reasons: [
            crossedUp ? 'Fresh EMA9 × EMA21 crossover' : 'EMA stack confirmed on the last close',
            'EMA9 > EMA21 > EMA50',
            `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.25×`,
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
        reasons: crossedUp ? ['Intrabar EMA9 × EMA21 crossover'] : ['Price testing EMA21 (±0.25×ATR)'],
      }),
    );
  } else if (Math.abs(snap.ema9 - snap.ema21) <= 0.2 * snap.atr || (snap.ema9 > snap.ema21 && snap.ema21 > snap.ema50 && testingEma21)) {
    out.push(
      finalize('ema-crossover', ctx, {
        direction: 'LONG',
        stage: 'POTENTIAL',
        ...levels('LONG'),
        reasons: ['EMA9 coiling within 0.20×ATR of EMA21', 'Uptrend stack intact, awaiting the cross'],
      }),
    );
  }

  if (crossedDown || (snap.ema9 < snap.ema21 && snap.ema21 < snap.ema50 && closedEma9 < closedEma21 && closedEma21 < closedEma50)) {
    if (snap.rvol >= 1.25 && !nearLow) {
      out.push(
        finalize('ema-crossover', ctx, {
          direction: 'SHORT',
          stage: 'ENTRY_READY',
          ...levels('SHORT'),
          reasons: [
            crossedDown ? 'Fresh EMA9 × EMA21 crossunder' : 'EMA stack confirmed on the last close',
            'EMA9 < EMA21 < EMA50',
            `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.25×`,
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
        reasons: crossedDown ? ['Intrabar EMA9 × EMA21 crossunder'] : ['Price testing EMA21 (±0.25×ATR)'],
      }),
    );
  } else if (Math.abs(snap.ema9 - snap.ema21) <= 0.2 * snap.atr || (snap.ema9 < snap.ema21 && snap.ema21 < snap.ema50 && testingEma21)) {
    out.push(
      finalize('ema-crossover', ctx, {
        direction: 'SHORT',
        stage: 'POTENTIAL',
        ...levels('SHORT'),
        reasons: ['EMA9 coiling within 0.20×ATR of EMA21', 'Downtrend stack intact, awaiting the cross'],
      }),
    );
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* 4. 🔵 Hidden Bullish                                                       */
/* -------------------------------------------------------------------------- */

function hiddenBullish(ctx: ScanContext): ScannerSignal[] {
  const { snap, a } = ctx;
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
    if (brokeMss && c > snap.ema9 && snap.rvol >= 1.2) {
      return [
        finalize('hidden-bullish', ctx, {
          direction: 'LONG',
          stage: 'ENTRY_READY',
          ...levels('LONG'),
          reasons: [
            'Price closed above the micro-swing high (MSS break)',
            `Hidden bullish divergence: higher low + lower RSI low at ${hb.rsiAtT2.toFixed(1)}`,
            'Price above EMA9',
            `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.20×`,
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
          'Hidden bullish divergence detected in the RSI 30–40 zone',
          `Swing low ${hb.t1} → ${hb.t2} formed a higher low`,
        ],
      }),
    ];
  }

  const brokeMss = c < hb.mss;
  const rsiTurned = snap.rsi <= snap.rsiPrev - 1.5;
  if (brokeMss && c < snap.ema9 && snap.rvol >= 1.2) {
    return [
      finalize('hidden-bullish', ctx, {
        direction: 'SHORT',
        stage: 'ENTRY_READY',
        ...levels('SHORT'),
        reasons: [
          'Price closed below the micro-swing low (MSS break)',
          `Hidden bearish divergence: lower high + higher RSI high at ${hb.rsiAtT2.toFixed(1)}`,
          'Price below EMA9',
          `RVOL ${snap.rvol.toFixed(2)}× ≥ 1.20×`,
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
        'Hidden bearish divergence detected in the RSI 60–70 zone',
        `Swing high ${hb.t1} → ${hb.t2} formed a lower high`,
      ],
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* 5. 🎯 Alpha Sniper                                                         */
/* -------------------------------------------------------------------------- */

function alphaSniper(ctx: ScanContext): ScannerSignal[] {
  const { snap, st, tf } = ctx;
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

  const crossUp30 = aPrev <= 30 && a > 30;
  const crossUp50 = aPrev <= 50 && a > 50;
  const crossDown70 = aPrev >= 70 && a < 70;
  const crossDown50 = aPrev >= 50 && a < 50;

  /* LONG */
  if ((crossUp30 || crossUp50) && snap.ema13 >= snap.ema34 && c > forming.o) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'LONG',
        stage: 'ENTRY_READY',
        ...levels('LONG'),
        reasons: [
          `Alpha Sniper crossed ${crossUp30 ? '30' : '50'} upward (${a.toFixed(1)})`,
          'EMA13 ≥ EMA34 alignment',
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
        reasons: ['Alpha Sniper crossing 30 upward', 'Awaiting EMA13/EMA34 alignment'],
      }),
    );
  } else if (a < 33 && a > aPrev) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'LONG',
        stage: 'POTENTIAL',
        ...levels('LONG'),
        reasons: [`Alpha Sniper ${a.toFixed(1)} curling up below 33`, 'Channel extreme forming'],
      }),
    );
  }

  /* SHORT */
  if ((crossDown70 || crossDown50) && snap.ema13 <= snap.ema34 && c < forming.o) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'SHORT',
        stage: 'ENTRY_READY',
        ...levels('SHORT'),
        reasons: [
          `Alpha Sniper crossed ${crossDown70 ? '70' : '50'} downward (${a.toFixed(1)})`,
          'EMA13 ≤ EMA34 alignment',
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
        reasons: ['Alpha Sniper crossing 70 downward', 'Awaiting EMA13/EMA34 alignment'],
      }),
    );
  } else if (a > 67 && a < aPrev) {
    out.push(
      finalize('alpha-sniper', ctx, {
        direction: 'SHORT',
        stage: 'POTENTIAL',
        ...levels('SHORT'),
        reasons: [`Alpha Sniper ${a.toFixed(1)} curling down above 67`, 'Channel extreme forming'],
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
    const ctx: ScanContext = { st, tf, htf, now, snap, htfSnap, a, htfA };
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
