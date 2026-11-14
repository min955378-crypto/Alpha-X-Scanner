import {
  Candle,
  atrWilder,
  bodyRatio,
  emaNext,
  emaSeries,
  highestHigh,
  lowestLow,
  pivotHighs,
  pivotLows,
  rsiFromAverages,
  rvol,
  wilderRsiAdvance,
  wilderRsiIntrabar,
  wilderRsiSeed,
  type WilderState,
} from '@/lib/indicators';
import {
  TF_SECONDS,
  type CoinSnapshot,
  type EmaStatus,
  type MarketFrame,
  type MarketSentiment,
  type ObStatus,
  type Spotlight,
  type Timeframe,
  type TopMover,
  type ZoneId,
  zoneForRsi,
} from '@/lib/types';
import {
  SimProfile,
  generateSeries,
  makeNormal,
  makeProfile,
  mulberry32,
  nextSimPrice,
  tickCandle,
} from './simulator';
import type { UniverseEntry } from './universe';

const BAR_MS: Record<Timeframe, number> = {
  '15M': 900_000,
  '30M': 1_800_000,
  '1H': 3_600_000,
  '4H': 14_400_000,
  '1D': 86_400_000,
};

const EMA_PERIODS = [9, 13, 21, 34, 50] as const;
const CLOSED_VOL_WINDOW = 20;

/* -------------------------------------------------------------------------- */
/* Analysis cache                                                             */
/* -------------------------------------------------------------------------- */

export interface ObState {
  type: 'DEMAND' | 'SUPPLY';
  lo: number;
  hi: number;
  /** Mitigation count after the impulse (0 = fresh). */
  touches: number;
  kIndex: number;
}

export interface HiddenBull {
  type: 'BULL' | 'BEAR';
  /** Index (into `candles`) of the first / second swing. */
  t1: number;
  t2: number;
  /** Micro-swing-structure level price must break to confirm. */
  mss: number;
  rsiAtT2: number;
}

export interface TfAnalysis {
  candles: Candle[];
  closes: number[];
  highs: number[];
  lows: number[];
  rsiSeries: number[];
  atr: number;
  ema: Record<number, number>;
  rsiAtClose: number;
  pivotsHigh: Array<{ index: number; price: number }>;
  pivotsLow: Array<{ index: number; price: number }>;
  ob: ObState | null;
  hb: HiddenBull | null;
  wr500: { wins: number; losses: number; closed: number };
  swingHigh20: number;
  swingLow20: number;
}

/* -------------------------------------------------------------------------- */
/* Symbol state                                                               */
/* -------------------------------------------------------------------------- */

interface TfState {
  candles: Candle[];
  /** Wilder state as of the last official candle close. */
  wilder: WilderState;
  rsiAtClose: number;
  lastClosedClose: number;
  ema: Record<number, number>;
  alphaSniperAtClose: number;
  atrAtClose: number;
  closedVols: number[];
  rsiLastCycle: number | null;
  analysis: TfAnalysis | null;
  analysisDirty: boolean;
  /** Cycle-id memo so every consumer in a 60s cycle sees one identical value. */
  cycleStamp: number;
  cycleSnap: CoinSnapshot | null;
}

export interface SymbolState {
  entry: UniverseEntry;
  profile: SimProfile;
  enabled: boolean;
  isMonitoringTag: boolean;
  manualTagOverride: boolean;
  hasPerpetual: boolean;
  fundingRatePct: number | null;
  spreadPct: number;
  price: number;
  pricePrevTick: number;
  changePct24h: number;
  quoteVol24h: number;
  high24h: number;
  low24h: number;
  tf: Record<Timeframe, TfState>;
  /** True once the Phase B 500-candle backfill has run for this symbol. */
  backfilled500: boolean;
  rand: () => number;
  normal: () => number;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export class MarketStore {
  readonly symbols = new Map<string, SymbolState>();
  /** Insertion-ordered list for deterministic iteration. */
  readonly order: string[] = [];

  private zoneCounts: Record<ZoneId, number> = {
    GAINERS: 0,
    V1: 0,
    NEUTRAL: 0,
    HIDDEN_BULL: 0,
    OVERSOLD: 0,
    EXTREME: 0,
  };

  setUniverse(entries: UniverseEntry[]): void {
    this.symbols.clear();
    this.order.length = 0;
    entries.forEach((entry, i) => {
      const profile = makeProfile(entry, i);
      const rand = mulberry32(profile.seed ^ 0x9e3779b9);
      const state: SymbolState = {
        entry,
        profile,
        enabled: true,
        isMonitoringTag: entry.isMonitoringTag,
        manualTagOverride: false,
        hasPerpetual: profile.hasPerpetual,
        fundingRatePct: profile.fundingRatePct,
        spreadPct: profile.spreadPct,
        price: 0,
        pricePrevTick: 0,
        changePct24h: 0,
        quoteVol24h: 0,
        high24h: 0,
        low24h: 0,
        tf: {} as Record<Timeframe, TfState>,
        /**
         * §2.2  Phase B status lives on the SYMBOL, not the timeframe: a
         * timeframe materialised lazily (user switches to 4H after the
         * backfill ran) must inherit the completed state, otherwise its
         * 500-candle win rate would stay null forever.
         */
        backfilled500: false,
        rand,
        normal: makeNormal(rand),
      };
      this.symbols.set(entry.symbol, state);
      this.order.push(entry.symbol);
    });
  }

  get(symbol: string): SymbolState | undefined {
    return this.symbols.get(symbol);
  }

  list(): SymbolState[] {
    const out: SymbolState[] = [];
    for (const s of this.order) {
      const st = this.symbols.get(s);
      if (st) out.push(st);
    }
    return out;
  }

  enabledList(): SymbolState[] {
    return this.list().filter((s) => s.enabled);
  }

  /* ------------------------------ Seeding -------------------------------- */

  /** Seed one symbol across all five timeframes (a single Phase A request). */
  seedSymbol(symbol: string, now: number): void {
    const st = this.symbols.get(symbol);
    if (!st || st.tf['1H']) return;
    const p = st.profile;

    const h1 = generateSeries(p, BAR_MS['1H'], 520, now);

    /**
     * Every timeframe is generated on its own bar clock with a volatility
     * scaled by sqrt(barMs), so a 1D bar really is ~4.9x wider than a 1H bar.
     * Deriving 4H/1D by *aggregating* the 1H series instead left the daily
     * chart with only 21 bars of history and an RSI pinned near 50 for the
     * whole book — the heatmap looked dead on the higher timeframes.
     */
    const vs = (tf: Timeframe) => Math.sqrt(BAR_MS[tf] / BAR_MS['1H']);
    const m15 = generateSeries(p, BAR_MS['15M'], 240, now, 1, vs('15M'));
    const m30 = generateSeries(p, BAR_MS['30M'], 240, now, 1, vs('30M'));
    const h4 = generateSeries(p, BAR_MS['4H'], 260, now, 1, vs('4H'));
    const d1 = generateSeries(p, BAR_MS['1D'], 260, now, 1, vs('1D'));

    st.tf['1H'] = this.buildTfState(h1);
    st.tf['15M'] = this.buildTfState(m15);
    st.tf['30M'] = this.buildTfState(m30);
    st.tf['4H'] = this.buildTfState(h4);
    st.tf['1D'] = this.buildTfState(d1);

    // Every timeframe must agree on the live price, so re-anchor the others
    // onto the 1H close (the series the tick loop advances).
    const livePrice = h1[h1.length - 1].c;
    for (const series of [m15, m30, h4, d1]) {
      const last = series[series.length - 1].c;
      if (!isFinite(last) || last <= 0) continue;
      const k = livePrice / last;
      for (const c of series) {
        c.o *= k;
        c.h *= k;
        c.l *= k;
        c.c *= k;
      }
    }
    st.price = livePrice;
    st.pricePrevTick = livePrice;
    this.recomputeQuote(st);
  }

  /**
   * §7.3  Per-cycle best score per `SYMBOL|TIMEFRAME`, set by the engine once
   * the scanners have run. Held on the store so `snapshot()` can attach the
   * identical number the scanner card will show.
   */
  private scores = new Map<string, number>();

  setScores(map: Map<string, number>): void {
    this.scores = map;
  }

  /** Mark the 500-candle backfill complete for a symbol (Phase B). */
  markBackfilled(symbol: string): void {
    const st = this.symbols.get(symbol);
    if (!st) return;
    st.backfilled500 = true;
    // Invalidate the per-cycle snapshot memo. Without this, any coin whose
    // snapshot was memoised in the cycle BEFORE its backfill landed keeps
    // reporting wr500 = null for a full 60s, breaking the §7.2 invariant.
    for (const tf of Object.keys(st.tf) as Timeframe[]) {
      st.tf[tf].cycleStamp = -1;
      st.tf[tf].cycleSnap = null;
    }
  }

  private buildTfState(candles: Candle[]): TfState {
    const closed = candles.slice(0, -1);
    const closes = closed.map((c) => c.c);
    const wilder = wilderRsiSeed(closes, 14);

    const ema: Record<number, number> = {};
    for (const period of EMA_PERIODS) {
      const series = emaSeries(closes, period);
      ema[period] = series[series.length - 1] ?? closes[closes.length - 1] ?? 0;
    }

    const closedVols = closed.slice(-CLOSED_VOL_WINDOW).map((c) => c.v);

    // Seed Alpha Sniper from the real EMA(RSI,3) series. Seeding it with the
    // raw RSI instead would make the first crossover() tests fire on noise.
    const rsiSeries = rsiSeriesFromCloses(closes);
    const alphaSeries = emaSeries(rsiSeries, 3);

    return {
      candles,
      wilder,
      rsiAtClose: wilder.rsi,
      lastClosedClose: closes[closes.length - 1] ?? candles[0].c,
      ema,
      alphaSniperAtClose: alphaSeries[alphaSeries.length - 1] ?? wilder.rsi,
      atrAtClose: atrWilder(candles, 14),
      closedVols,
      rsiLastCycle: null,
      analysis: null,
      analysisDirty: true,
      cycleStamp: -1,
      cycleSnap: null,
    };
  }

  /* ------------------------------- Ticking ------------------------------- */

  /** Advance the simulated market by `dtSec` seconds. */
  tick(now: number, dtSec: number): void {
    for (const st of this.symbols.values()) {
      if (!st.tf['1H']) continue;
      const prev = st.price;
      const next = nextSimPrice(st.profile, prev, dtSec, st.rand, st.normal);
      st.pricePrevTick = prev;
      st.price = next;

      for (const tf of Object.keys(st.tf) as Timeframe[]) {
        const tfs = st.tf[tf];
        const forming = tfs.candles[tfs.candles.length - 1];
        const barMs = BAR_MS[tf];
        const share = Math.min(1, (dtSec * 1000) / barMs);
        const volAdd = st.profile.hourlyQuoteVol * (barMs / 3_600_000) * share * (0.3 + st.rand() * 1.4);
        tickCandle(forming, next, volAdd);
      }

      this.recomputeQuote(st);
    }
  }

  /**
   * §4.4  Raw candle history for one symbol/timeframe.
   *
   * Returns a defensive copy — callers (the klines API, the native chart) must
   * never be able to mutate the engine's working series.
   */
  candles(symbol: string, tf: Timeframe): Candle[] | null {
    const st = this.symbols.get(symbol) ?? this.symbols.get(`${symbol}USDT`);
    const tfs = st?.tf[tf];
    if (!tfs || !tfs.candles.length) return null;
    return tfs.candles.map((c) => ({ ...c }));
  }

  /**
   * §4.2  Apply a live `!miniTicker@arr` row.
   *
   * In LIVE mode this — not the simulator — is what moves the price. It costs
   * zero REST weight and pushes every symbol once per second. The forming
   * candle on every timeframe is updated so RSI / EMA / ATR / RVOL stay
   * intrabar-accurate between the 60-second recompute cycles.
   */
  applyMiniTicker(symbol: string, last: number, quoteVol: number | null): void {
    const st = this.symbols.get(symbol);
    if (!st || !st.tf['1H']) return;
    if (!Number.isFinite(last) || last <= 0) return;

    st.pricePrevTick = st.price;
    st.price = last;
    if (quoteVol !== null && Number.isFinite(quoteVol) && quoteVol > 0) st.quoteVol24h = quoteVol;

    for (const tf of Object.keys(st.tf) as Timeframe[]) {
      const tfs = st.tf[tf];
      const forming = tfs.candles[tfs.candles.length - 1];
      if (!forming) continue;
      if (last > forming.h) forming.h = last;
      if (last < forming.l) forming.l = last;
      forming.c = last;
    }

    this.recomputeQuote(st);
  }

  /** Roll candles that have reached their interval boundary. */
  rollCandles(now: number): number {
    let closed = 0;
    for (const st of this.symbols.values()) {
      if (!st.tf['1H']) continue;
      for (const tf of Object.keys(st.tf) as Timeframe[]) {
        const tfs = st.tf[tf];
        const forming = tfs.candles[tfs.candles.length - 1];
        const barMs = BAR_MS[tf];
        if (now < forming.t + barMs) continue;

        const prevClose = forming.c;
        forming.x = true;

        // Advance Wilder's smoothing — ONLY on an official close (§2.3).
        const advanced = wilderRsiAdvance(tfs.wilder, prevClose, tfs.lastClosedClose, 14);
        tfs.wilder = advanced;
        tfs.rsiAtClose = advanced.rsi;
        tfs.lastClosedClose = prevClose;

        for (const period of EMA_PERIODS) tfs.ema[period] = emaNext(tfs.ema[period], prevClose, period);
        tfs.alphaSniperAtClose = emaNext(tfs.alphaSniperAtClose, advanced.rsi, 3);

        tfs.closedVols.push(forming.v);
        if (tfs.closedVols.length > CLOSED_VOL_WINDOW) tfs.closedVols.shift();

        tfs.candles.push({ t: forming.t + barMs, o: prevClose, h: prevClose, l: prevClose, c: prevClose, v: 0, x: false });
        if (tfs.candles.length > 520) tfs.candles.shift();

        tfs.atrAtClose = atrWilder(tfs.candles, 14);
        tfs.analysisDirty = true;
        closed += 1;
      }
    }
    return closed;
  }

  private recomputeQuote(st: SymbolState): void {
    const tfs = st.tf['1H'];
    if (!tfs) return;
    const candles = tfs.candles;
    const n = candles.length;
    const start = Math.max(0, n - 24);

    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (let i = start; i < n; i += 1) {
      h = Math.max(h, candles[i].h);
      l = Math.min(l, candles[i].l);
      v += candles[i].v;
    }

    const refClose = candles[Math.max(0, n - 25)].c;
    st.changePct24h = refClose > 0 ? ((st.price - refClose) / refClose) * 100 : 0;
    st.high24h = h === -Infinity ? st.price : h;
    st.low24h = l === Infinity ? st.price : l;
    st.quoteVol24h = v;
  }

  /* ------------------------------ Analysis ------------------------------- */

  getAnalysis(st: SymbolState, tf: Timeframe): TfAnalysis {
    const tfs = st.tf[tf];
    if (!tfs.analysis || tfs.analysisDirty) {
      tfs.analysis = this.computeAnalysis(tfs);
      tfs.analysisDirty = false;
    }
    return tfs.analysis;
  }

  private computeAnalysis(tfs: TfState): TfAnalysis {
    const candles = tfs.candles.slice(0, -1);
    const closes = candles.map((c) => c.c);
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);

    const rsiSeries = rsiSeriesFromCloses(closes);
    const atr = atrWilder(tfs.candles, 14);

    const ema: Record<number, number> = {};
    for (const period of EMA_PERIODS) {
      const series = emaSeries(closes, period);
      ema[period] = series[series.length - 1] ?? tfs.ema[period];
    }

    return {
      candles,
      closes,
      highs,
      lows,
      rsiSeries,
      atr,
      ema,
      rsiAtClose: tfs.rsiAtClose,
      pivotsHigh: pivotHighs(candles, 5, 5),
      pivotsLow: pivotLows(candles, 5, 5),
      ob: this.findOrderBlock(candles, atr),
      hb: this.findHiddenBull(candles, rsiSeries),
      wr500: backtestAlphaSniper(candles.slice(-500)),
      swingHigh20: highestHigh(candles, 20),
      swingLow20: lowestLow(candles, 20),
    };
  }

  /* --------------------------- Order Block (§7.2) ------------------------- */

  private findOrderBlock(candles: Candle[], atr: number): ObState | null {
    if (atr <= 0 || candles.length < 30) return null;
    const start = Math.max(0, candles.length - 120);

    for (let k = candles.length - 5; k >= start; k -= 1) {
      const kc = candles[k];
      const i1 = candles[k + 1];
      const i3 = candles[k + 3];
      if (!i1 || !i3) continue;

      // Bullish demand: last bearish candle before a 3-bar impulse + BOS + FVG.
      if (kc.c < kc.o) {
        const swingHigh = highestHigh(candles.slice(Math.max(0, k - 10), k + 1), 10);
        const impulseClose = i3.c;
        const fvg = candles[k + 2] && candles[k + 2].l > kc.h;
        if (impulseClose > swingHigh && fvg) {
          const width = kc.h - kc.l;
          if (width >= 0.15 * atr && width <= 1.6 * atr) {
            const touches = this.countTouches(candles, k + 4, kc.l, kc.h, 'DEMAND');
            if (touches <= 1) return { type: 'DEMAND', lo: kc.l, hi: kc.h, touches, kIndex: k };
          }
        }
      }

      // Bearish supply: last bullish candle before a 3-bar drop + BOS + FVG.
      if (kc.c > kc.o) {
        const swingLow = lowestLow(candles.slice(Math.max(0, k - 10), k + 1), 10);
        const impulseClose = i3.c;
        const fvg = candles[k + 2] && candles[k + 2].h < kc.l;
        if (impulseClose < swingLow && fvg) {
          const width = kc.h - kc.l;
          if (width >= 0.15 * atr && width <= 1.6 * atr) {
            const touches = this.countTouches(candles, k + 4, kc.l, kc.h, 'SUPPLY');
            if (touches <= 1) return { type: 'SUPPLY', lo: kc.l, hi: kc.h, touches, kIndex: k };
          }
        }
      }
    }
    return null;
  }

  private countTouches(candles: Candle[], from: number, lo: number, hi: number, type: 'DEMAND' | 'SUPPLY'): number {
    let n = 0;
    for (let i = from; i < candles.length; i += 1) {
      const c = candles[i];
      if (type === 'DEMAND' ? c.l <= hi : c.h >= lo) n += 1;
      if (n > 1) return n;
    }
    return n;
  }

  /* -------------------------- Hidden Bullish (§7.2) ----------------------- */

  private findHiddenBull(candles: Candle[], rsiSeries: number[]): HiddenBull | null {
    const lows = pivotLows(candles, 4, 4);
    const highs = pivotHighs(candles, 4, 4);
    const n = candles.length;

    // Long: price higher-low + RSI lower-low, RSI in [30, 40].
    for (let i = lows.length - 1; i >= 1; i -= 1) {
      const t2 = lows[i];
      const t1 = lows[i - 1];
      const gap = t2.index - t1.index;
      if (gap < 5 || gap > 40) continue;
      if (n - t2.index > 25) continue;
      const rsiT2 = rsiSeries[t2.index] ?? 50;
      const rsiT1 = rsiSeries[t1.index] ?? 50;
      if (t2.price > t1.price && rsiT2 < rsiT1 && rsiT2 >= 30 && rsiT2 <= 40) {
        const mss = highestHigh(candles.slice(t1.index, t2.index + 1), t2.index - t1.index + 1);
        return { type: 'BULL', t1: t1.index, t2: t2.index, mss, rsiAtT2: rsiT2 };
      }
    }

    // Short: price lower-high + RSI higher-high, RSI in [60, 70].
    for (let i = highs.length - 1; i >= 1; i -= 1) {
      const t2 = highs[i];
      const t1 = highs[i - 1];
      const gap = t2.index - t1.index;
      if (gap < 5 || gap > 40) continue;
      if (n - t2.index > 25) continue;
      const rsiT2 = rsiSeries[t2.index] ?? 50;
      const rsiT1 = rsiSeries[t1.index] ?? 50;
      if (t2.price < t1.price && rsiT2 > rsiT1 && rsiT2 >= 60 && rsiT2 <= 70) {
        const mss = lowestLow(candles.slice(t1.index, t2.index + 1), t2.index - t1.index + 1);
        return { type: 'BEAR', t1: t1.index, t2: t2.index, mss, rsiAtT2: rsiT2 };
      }
    }
    return null;
  }

  /* ------------------------------- Snapshot ------------------------------- */

  /**
   * Memoised per 60s cycle: the first caller advances the RSI delta baseline,
   * every later caller (scanners, Coin Finder, HTF alignment) reuses it so the
   * whole cycle is internally consistent.
   */
  snapshot(st: SymbolState, tf: Timeframe, now: number, cycleId: number): CoinSnapshot {
    const tfs = st.tf[tf];
    if (tfs.cycleStamp === cycleId && tfs.cycleSnap) return tfs.cycleSnap;
    const forming = tfs.candles[tfs.candles.length - 1];
    const prevClose = tfs.lastClosedClose;

    const rsi = wilderRsiIntrabar(tfs.wilder, forming.c, prevClose, 14);
    const rsiPrev = tfs.rsiLastCycle ?? rsi;
    tfs.rsiLastCycle = rsi;

    const ema9 = emaNext(tfs.ema[9], forming.c, 9);
    const ema13 = emaNext(tfs.ema[13], forming.c, 13);
    const ema21 = emaNext(tfs.ema[21], forming.c, 21);
    const ema34 = emaNext(tfs.ema[34], forming.c, 34);
    const ema50 = emaNext(tfs.ema[50], forming.c, 50);

    const tr = Math.max(forming.h - forming.l, Math.abs(forming.h - prevClose), Math.abs(forming.l - prevClose));
    const atr = (tfs.atrAtClose * 13 + tr) / 14;
    const alphaSniper = emaNext(tfs.alphaSniperAtClose, rsi, 3);

    const elapsedSec = Math.max(0, (now - forming.t) / 1000);
    const rv = rvol(forming.v, tfs.closedVols, TF_SECONDS[tf], elapsedSec);

    const a = this.getAnalysis(st, tf);
    const zoneOb = a.ob;

    let obStatus: ObStatus = 'NONE';
    if (zoneOb) {
      const inside = st.price >= zoneOb.lo && st.price <= zoneOb.hi;
      const near = Math.min(Math.abs(st.price - zoneOb.lo), Math.abs(st.price - zoneOb.hi)) <= 0.15 * a.atr;
      if (zoneOb.type === 'DEMAND' && (inside || near)) obStatus = 'DEMAND_BUY';
      else if (zoneOb.type === 'SUPPLY' && (inside || near)) obStatus = 'SUPPLY_WAIT';
    }

    let emaStatus: EmaStatus = 'NONE';
    if (ema9 > ema21 && ema21 > ema50) emaStatus = 'GOLDEN_9_21';
    else if (ema9 < ema21 && ema21 < ema50) emaStatus = 'DEATH_9_21';
    if (ema13 >= ema34 && alphaSniper < 34 && forming.c > forming.o) emaStatus = 'SNIPER_BUY';
    else if (ema13 <= ema34 && alphaSniper > 66 && forming.c < forming.o) emaStatus = 'SNIPER_SELL';

    const snap: CoinSnapshot = {
      symbol: st.entry.symbol,
      baseAsset: st.entry.baseAsset,
      enabled: st.enabled,
      hasPerpetual: st.hasPerpetual,
      isMonitoringTag: st.isMonitoringTag,
      price: st.price,
      changePct24h: st.changePct24h,
      quoteVol24h: st.quoteVol24h,
      high24h: st.high24h,
      low24h: st.low24h,
      spreadPct: st.spreadPct,
      fundingRatePct: st.hasPerpetual ? st.fundingRatePct : null,
      rsi,
      rsiPrev,
      rsiDelta: rsi - rsiPrev,
      rvol: rv,
      atr,
      atrPct: st.price > 0 ? (atr / st.price) * 100 : 0,
      ema9,
      ema13,
      ema21,
      ema34,
      ema50,
      alphaSniper,
      alphaSniperPrev: tfs.alphaSniperAtClose,
      open: forming.o,
      high: forming.h,
      low: forming.l,
      prevClose,
      obStatus,
      emaStatus,
      wr500: st.backfilled500 && a.wr500.closed >= 5 ? (a.wr500.wins / a.wr500.closed) * 100 : null,
      closedTrades500: a.wr500.closed,
      score: this.scores.get(`${st.entry.symbol}|${tf}`) ?? 0,
    };

    tfs.cycleStamp = cycleId;
    tfs.cycleSnap = snap;
    return snap;
  }

  /* --------------------------------- Frame -------------------------------- */

  buildFrame(
    tf: Timeframe,
    now: number,
    nextUpdateSec: number,
    cycle: number,
    dataMode: 'LIVE' | 'SIMULATED',
    boot?: MarketFrame['boot'],
    riskWatchUpdatedAt: number | null = null,
  ): MarketFrame {
    const coins: CoinSnapshot[] = [];
    let rising = 0;
    let falling = 0;
    let monitoring = 0;
    let perpetual = 0;
    const zoneCounts: Record<ZoneId, number> = {
      GAINERS: 0,
      V1: 0,
      NEUTRAL: 0,
      HIDDEN_BULL: 0,
      OVERSOLD: 0,
      EXTREME: 0,
    };

    const movers: TopMover[] = [];
    let spotlight: Spotlight | null = null;

    for (const st of this.symbols.values()) {
      if (!st.tf[tf] || !st.enabled) continue;
      const snap = this.snapshot(st, tf, now, cycle);
      coins.push(snap);

      if (st.isMonitoringTag) monitoring += 1;
      if (st.hasPerpetual) perpetual += 1;
      if (snap.changePct24h > 0) rising += 1;
      else falling += 1;
      zoneCounts[zoneForRsi(snap.rsi).id] += 1;

      movers.push({
        symbol: snap.symbol,
        baseAsset: snap.baseAsset,
        changePct24h: snap.changePct24h,
        isMonitoringTag: snap.isMonitoringTag,
      });

      // §6.1  RSI 52-55 Rising spotlight.
      if (!snap.isMonitoringTag && snap.rsi >= 52 && snap.rsi <= 55 && snap.changePct24h > 0) {
        if (!spotlight || snap.rsiDelta > spotlight.rsiDelta) {
          spotlight = { symbol: snap.symbol, baseAsset: snap.baseAsset, rsi: snap.rsi, rsiDelta: snap.rsiDelta };
        }
      }
    }

    movers.sort((a, b) => b.changePct24h - a.changePct24h);
    const topMovers = movers.slice(0, 5);

    const total = rising + falling;
    const risingPct = total > 0 ? (rising / total) * 100 : 0;
    const sentiment: MarketSentiment = {
      label: risingPct > 55 ? 'BULLISH' : risingPct < 45 ? 'BEARISH' : 'NEUTRAL',
      glyph: risingPct > 55 ? '↗' : risingPct < 45 ? '↘' : '→',
      risingPct: Math.round(risingPct),
      fallingPct: Math.round(100 - risingPct),
      risingCount: rising,
      fallingCount: falling,
      totalEnabled: total,
    };

    this.zoneCounts = zoneCounts;

    return {
      t: now,
      timeframe: tf,
      nextUpdateSec,
      cycle,
      dataMode,
      coins,
      sentiment,
      topMovers,
      spotlight,
      counts: {
        total: this.symbols.size,
        enabled: total,
        monitoringTag: monitoring,
        perpetual,
        zones: zoneCounts,
      },
      boot:
        boot ?? {
          phase: 'READY',
          seeded: coins.length,
          total: this.symbols.size,
          weightUsedMin: 0,
          phaseAReady: true,
          phaseBReady: true,
          elapsedSec: 0,
          phaseAElapsedSec: 0,
        },
      riskWatchUpdatedAt,
    };
  }

  get zoneTally(): Record<ZoneId, number> {
    return this.zoneCounts;
  }
}

/** Wilder RSI(14) series aligned 1:1 with the given closes. */
export function rsiSeriesFromCloses(closes: number[]): number[] {
  if (closes.length < 2) return closes.map(() => 50);

  const out = new Array<number>(closes.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  const seedLen = Math.min(closes.length - 1, 14);

  for (let i = 1; i <= seedLen; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= seedLen;
  avgLoss /= seedLen;
  out[seedLen] = rsiFromAverages(avgGain, avgLoss);

  for (let i = seedLen + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    const u = d > 0 ? d : 0;
    const dn = d < 0 ? -d : 0;
    avgGain = (avgGain * 13 + u) / 14;
    avgLoss = (avgLoss * 13 + dn) / 14;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* §9.2  Alpha Sniper 500-candle backtest (mirrors the Pine v5 engine)        */
/* -------------------------------------------------------------------------- */

export function backtestAlphaSniper(
  candles: Candle[],
  tpMult = 1.5,
  slMult = 1.0,
  minTrades = 5,
): { wins: number; losses: number; closed: number } {
  if (candles.length < 60) return { wins: 0, losses: 0, closed: 0 };

  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);

  const rsiRaw = (() => {
    const out = new Array<number>(closes.length).fill(50);
    let avgGain = 0;
    let avgLoss = 0;
    const seedLen = Math.min(closes.length - 1, 14);
    for (let i = 1; i <= seedLen; i += 1) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) avgGain += d;
      else avgLoss -= d;
    }
    avgGain /= seedLen;
    avgLoss /= seedLen;
    out[seedLen] = rsiFromAverages(avgGain, avgLoss);
    for (let i = seedLen + 1; i < closes.length; i += 1) {
      const d = closes[i] - closes[i - 1];
      const u = d > 0 ? d : 0;
      const dn = d < 0 ? -d : 0;
      avgGain = (avgGain * 13 + u) / 14;
      avgLoss = (avgLoss * 13 + dn) / 14;
      out[i] = rsiFromAverages(avgGain, avgLoss);
    }
    return out;
  })();

  const alpha = emaSeries(rsiRaw, 3);
  const emaFast = emaSeries(closes, 13);
  const emaSlow = emaSeries(closes, 34);
  const atrSeries = (() => {
    const out = new Array<number>(candles.length).fill(0);
    let seed = 0;
    const seedLen = Math.min(candles.length - 1, 14);
    for (let i = 1; i <= seedLen; i += 1) {
      seed += Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
    }
    let atr = seed / Math.max(1, seedLen);
    out[seedLen] = atr;
    for (let i = seedLen + 1; i < candles.length; i += 1) {
      const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
      atr = (atr * 13 + tr) / 14;
      out[i] = atr;
    }
    for (let i = 0; i < seedLen; i += 1) out[i] = atr;
    return out;
  })();

  let wins = 0;
  let losses = 0;
  let active = 0;
  let entryBar = -1;
  let tpPrice = 0;
  let slPrice = 0;
  const tradeBars: number[] = [];
  const outcomes: number[] = [];
  const lookback = Math.min(500, candles.length);

  for (let i = 0; i < candles.length; i += 1) {
    if (active === 1 && i > entryBar) {
      // SL-first, exactly like the Pine engine.
      if (lows[i] <= slPrice) {
        tradeBars.push(entryBar);
        outcomes.push(-1);
        active = 0;
      } else if (highs[i] >= tpPrice) {
        tradeBars.push(entryBar);
        outcomes.push(1);
        active = 0;
      }
    }

    const crossUp30 = i > 0 && alpha[i - 1] <= 30 && alpha[i] > 30;
    const crossUp50 = i > 0 && alpha[i - 1] <= 50 && alpha[i] > 50;
    const trigger = (crossUp30 || crossUp50) && emaFast[i] >= emaSlow[i] && closes[i] > candles[i].o && atrSeries[i] > 0;

    if (active === 0 && trigger) {
      active = 1;
      entryBar = i;
      tpPrice = closes[i] + atrSeries[i] * tpMult;
      slPrice = closes[i] - atrSeries[i] * slMult;
    }

    if (active === 1 && i - entryBar > lookback) active = 0;

    while (tradeBars.length > 0 && i - tradeBars[0] > lookback) {
      tradeBars.shift();
      outcomes.shift();
    }
  }

  for (const o of outcomes) {
    if (o === 1) wins += 1;
    else if (o === -1) losses += 1;
  }

  const closed = wins + losses;
  return { wins, losses, closed: closed >= minTrades ? closed : closed };
}

export { bodyRatio };
