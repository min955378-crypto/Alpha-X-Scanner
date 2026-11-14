import type { Candle } from '@/lib/indicators';
import type { UniverseEntry } from './universe';

/**
 * §2  Data-plane fallback: a deterministic synthetic Binance feed.
 *
 * The Global Quant Worker is identical in both modes — it consumes `Candle[]`
 * and runs the real Wilder RSI / EMA / ATR / RVOL math. Only the *source* of
 * those candles changes:
 *
 *   LIVE      -> Binance REST klines + `!miniTicker@arr` / `@kline_<tf>` WS
 *   SIMULATED -> this module (used whenever Binance is unreachable, e.g. an
 *                air-gapped sandbox, CI, or a local demo)
 *
 * Prices are produced by a mean-reverting GBM seeded per symbol, so the same
 * universe always boots into the same, reproducible market state.
 */

/* ---------------------------------- PRNG ---------------------------------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeNormal(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
}

/**
 * Real-world price anchors for the majors (USDT). Keeps `BTCUSDT` reading
 * ~$68,000 instead of a random magnitude, which matters for the dynamic
 * precision rules in §6.4 (col 4).
 */
const REAL_PRICES: Record<string, number> = {
  BTC: 68250, ETH: 3520, BNB: 592, SOL: 164, XRP: 0.618, ADA: 0.452, DOGE: 0.158,
  TRX: 0.128, AVAX: 27.8, LINK: 14.9, DOT: 6.42, TON: 7.15, LTC: 78.4, BCH: 418,
  UNI: 8.45, ATOM: 6.9, XLM: 0.108, ETC: 25.6, FIL: 5.42, APT: 8.9, NEAR: 5.35,
  ARB: 0.842, OP: 1.84, INJ: 25.8, SUI: 1.12, SEI: 0.548, TIA: 6.35, RUNE: 4.42,
  AAVE: 94.5, MKR: 1180, SNX: 2.18, CRV: 0.418, LDO: 1.68, GRT: 0.138, IMX: 1.58,
  GALA: 0.0278, SAND: 0.418, MANA: 0.446, AXS: 5.18, ENJ: 0.218, CHZ: 0.0745,
  POL: 0.518, ALGO: 0.158, VET: 0.0348, ICP: 9.42, HBAR: 0.0742, EGLD: 31.8,
  THETA: 1.88, FLOW: 0.718, EOS: 0.618, KSM: 27.4, ZIL: 0.0172, BAT: 0.188,
  ZRX: 0.418, IOTA: 0.188, NEO: 9.35, QTUM: 2.78, WAVES: 1.58, SC: 0.00648,
  DENT: 0.00092, CELO: 0.718, KAVA: 0.418, ROSE: 0.0885, KDA: 0.548, MINA: 0.442,
  CFX: 0.158, KAS: 0.138, RPL: 10.8, GMX: 27.8, DYDX: 1.08, PENDLE: 4.18,
  PEPE: 0.0000118, SHIB: 0.0000232, BONK: 0.0000278, WIF: 1.88, MEME: 0.0178,
  ORDI: 34.2, SATS: 0.00000035, '1000SATS': 0.00035, JUP: 0.842, PYTH: 0.378,
  W: 0.278, ENA: 0.418, ETHFI: 2.18, NOT: 0.0118, JTO: 2.42, KAITO: 1.32,
  APE: 1.18, BLUR: 0.238, LRC: 0.188, OCEAN: 0.588, BAND: 1.42, ANKR: 0.0248,
  COTI: 0.0885, RSR: 0.00685, OGN: 0.148, SYS: 0.0885, ONE: 0.0148, ONT: 0.218,
  PAXG: 2418, PERP: 0.688, QNT: 78.4, STX: 1.68, ZEC: 24.8, ZEN: 8.42,
  FTM: 0.588, XMR: 158, XTZ: 0.818, XVG: 0.00685, XVS: 5.42, YFI: 5840,
  COMP: 42.8, FET: 1.28, RENDER: 6.42, RNDR: 6.42, FLOKI: 0.000148,
  TURBO: 0.00685, HMSTR: 0.00418, CATI: 0.418, DOGS: 0.000412, REZ: 0.0385,
  FTT: 1.42, LUNC: 0.0000885, BTT: 0.00000088, WIN: 0.0000685,
  HOT: 0.00188, USDC: 1.0, FDUSD: 1.0, FRAX: 1.0,
};

/* -------------------------------- PROFILES -------------------------------- */

export interface SimProfile {
  symbol: string;
  baseAsset: string;
  seed: number;
  /** Per-bar volatility as a fraction (1H bars). */
  hourlyVol: number;
  drift: number;
  anchorPrice: number;
  /** Volatility multiplier for pegged (stable/gold) assets; 1 for everything else. */
  pegK: number;
  /** Typical quote volume per 1H bar, USDT. */
  hourlyQuoteVol: number;
  spreadPct: number;
  hasPerpetual: boolean;
  fundingRatePct: number | null;
}

export function makeProfile(entry: UniverseEntry, index: number): SimProfile {
  const seed = hashString(entry.symbol);
  const rand = mulberry32(seed);
  const normal = makeNormal(rand);

  // Majors keep their real-world order of magnitude so the terminal reads like
  // a live Binance book; everything else uses a log-uniform price.
  const real = REAL_PRICES[entry.baseAsset];
  const u = rand();
  const anchorPrice =
    real !== undefined
      ? real
      : Math.exp(Math.log(0.00008) + u * u * (Math.log(90000) - Math.log(0.00008)));

  // Liquidity rank: index 0 (BTC) is the most liquid, tail coins the least.
  const liquidity = Math.pow(1 - index / 640, 3.1);
  const hourlyQuoteVol = Math.exp(Math.log(4.0e4) + liquidity * Math.log(9.0e8 / 4.0e4)) * (0.45 + rand() * 1.4);

  // Calibrated against real 1H Binance spot bars: ~0.25%–1.4% hourly sigma,
  // which puts a typical 24h move in the ±3–12% band with rare ±25% outliers.
  // Pegged assets (stablecoins, gold tokens) barely move — letting them swing
  // 30% a day put FDUSD and PAXG at the top of the Top Movers panel.
  const pegK = PEG_VOL[entry.baseAsset] ?? 1;
  const volK = SIM.volK * pegK;
  const hourlyVol = (0.0025 + (1 - liquidity) * 0.009 + rand() * 0.002) * volK;
  const drift = (rand() - 0.5) * 0.0006;

  // Tighter books on liquid pairs (0.01%) than on tail pairs (up to 0.35%).
  const spreadPct = 0.008 + (1 - liquidity) * 0.26 + rand() * 0.05;

  const hasPerpetual = rand() < 0.62;
  const fundingRatePct = hasPerpetual ? (normal() * 0.018) : null;

  return {
    symbol: entry.symbol,
    baseAsset: entry.baseAsset,
    seed,
    hourlyVol,
    drift,
    anchorPrice,
    pegK,
    hourlyQuoteVol,
    spreadPct,
    hasPerpetual,
    fundingRatePct,
  };
}

/* ------------------------------ SERIES BUILD ------------------------------ */

/**
 * Generate `count` bars of `barMs` duration ending at `endMs`, with the final
 * bar left open (forming). Bars are aligned to real interval boundaries so
 * candle closes line up with wall-clock time, exactly as Binance does.
 */
/**
 * Calibration knobs. The defaults below were fitted offline with
 * `scripts/tune-sim.ts` to reproduce a realistic 1H book:
 * RSI sd ≈ 12 centred on 50, all six heatmap zones populated, and a 24h-change
 * distribution with p1/p99 of roughly ∓25%. Overridable from env for sweeps.
 */
/** Per-symbol volatility multiplier for pegged / price-stable assets. */
const PEG_VOL: Record<string, number> = {
  FDUSD: 0.02, USDC: 0.02, TUSD: 0.02, BUSD: 0.02, USD1: 0.02,
  PAXG: 0.25, XAUT: 0.25,
};

function num(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
export const SIM = {
  meanReversion: num('SIM_MR', 0.1),
  trendPersistence: num('SIM_TP', 0.97),
  trendInnovation: num('SIM_TI', 0.001),
  trendFrac: num('SIM_TF', 0.22),
  volK: num('SIM_VOL', 0.7),
};

export function generateSeries(
  profile: SimProfile,
  barMs: number,
  count: number,
  endMs: number,
  priceScale = 1,
  volScale = 1,
): Candle[] {
  const rand = mulberry32(profile.seed ^ Math.round(barMs));
  const normal = makeNormal(rand);
  const openTime = Math.floor(endMs / barMs) * barMs - (count - 1) * barMs;

  const out: Candle[] = [];
  let price = profile.anchorPrice * priceScale;
  /**
   * Reversion is per-BAR, not per-unit-time — deliberately independent of
   * `volScale`. Its job is to bound the drift over the 520 seeded bars, and
   * that bound compounds as (1-k)^N regardless of how long a bar is. Scaling
   * it with volScale pinned the 1D series to its anchor so hard that every
   * coin's daily RSI collapsed onto 50.
   * Clamped below 1: an exponent above 1 overshoots the anchor and turns the
   * peg into an oscillator, which is how FDUSD ended up 40% off its peg.
   */
  const meanReversion = Math.min(0.85, SIM.meanReversion / Math.max(profile.pegK, 0.05));

  /**
   * Slow, persistent trend component (AR(1)). Without it every coin becomes a
   * pure mean-reverting oscillator and the RSI distribution collapses around
   * 50 — a real Binance book always carries a handful of coins in genuine
   * Oversold / Extreme downtrends.
   */
  const trendPersistence = SIM.trendPersistence;
  const trendInnovation = SIM.trendInnovation;
  // Most coins oscillate; a minority get a genuine persistent trend. That is
  // what produces a realistic fat tail instead of 600 identical oscillators.
  const trendFrac = SIM.trendFrac;
  const trendAmp = (rand() < trendFrac ? 1 : 0.15) * profile.pegK;
  // Scaled by the bar's own volatility: a 1D bar carries ~4.9x the noise of a
  // 1H bar, so its trend must scale with it or the series degenerates into
  // pure noise and every coin's RSI collapses onto 50.
  const trendStep = trendInnovation * volScale;
  let trend = (rand() - 0.5) * trendStep * 2 * trendAmp;

  for (let i = 0; i < count; i += 1) {
    const t = openTime + i * barMs;
    const isLast = i === count - 1;
    const o = price;

    // Advance the persistent trend before pricing the bar.
    trend = trend * trendPersistence + normal() * trendStep * trendAmp;

    // Intrabar path: open -> high/low excursion -> close.
    const steps = isLast ? 1 : 6;
    let h = o;
    let l = o;
    let p = o;
    const stepVol = profile.hourlyVol * volScale * Math.sqrt(steps / 6);

    for (let s = 0; s < steps; s += 1) {
      const shock = (profile.drift + trend) * (steps / 6) + stepVol * normal();
      p = p * Math.exp(shock);
      h = Math.max(h, p);
      l = Math.min(l, p);
    }

    // Gentle pull back toward the anchor keeps a 600-coin universe sane.
    const pull = Math.pow(profile.anchorPrice * priceScale / p, meanReversion);
    p = p * pull;
    h = Math.max(h, p);
    l = Math.min(l, p);
    price = p;

    // Quote volume scales with the LENGTH of the bar only. Multiplying by
    // `volScale` (a price-volatility factor) double-counted it and depressed
    // RVOL(20) on the sub-hourly timeframes — 30M read 0.32 instead of ~1.0.
    const baseVol = profile.hourlyQuoteVol * (barMs / 3_600_000);
    const volMult = 0.35 + rand() * 1.3 + (rand() < 0.045 ? 3.2 + rand() * 5 : 0);
    // The forming bar must start with the volume it has ACTUALLY traded so far,
    // otherwise RVOL(20) opens ~5x too high on every newly seeded coin.
    const elapsedFraction = isLast ? Math.min(1, Math.max(0, (endMs - t) / barMs)) : 1;
    const v = baseVol * volMult * elapsedFraction;
    out.push({ t, o, h, l, c: p, v, x: !isLast });
  }

  return out;
}

/** Aggregate a lower-timeframe series into a higher one (15m -> 30m etc.). */
export function aggregate(src: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < src.length; i += factor) {
    const slice = src.slice(i, i + factor);
    if (slice.length === 0) continue;
    const o = slice[0].o;
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (const c of slice) {
      h = Math.max(h, c.h);
      l = Math.min(l, c.l);
      v += c.v;
    }
    const c = slice[slice.length - 1].c;
    out.push({ t: slice[0].t, o, h, l, c, v, x: slice[slice.length - 1].x });
  }
  return out;
}

/**
 * Advance a live forming candle by one price/volume tick.
 * Returns the updated candle in place (mutates for allocation-free 1 Hz ticks).
 */
export function tickCandle(candle: Candle, price: number, addVolume: number): void {
  candle.c = price;
  if (price > candle.h) candle.h = price;
  if (price < candle.l) candle.l = price;
  candle.v += addVolume;
}

export function nextSimPrice(profile: SimProfile, price: number, dtSec: number, rand: () => number, normal: () => number): number {
  const barsPerHour = 3600 / dtSec;
  const sigma = profile.hourlyVol / Math.sqrt(barsPerHour);
  const shock = profile.drift / barsPerHour + sigma * normal();
  const pull = Math.pow(profile.anchorPrice / price, 0.0009);
  const jitter = 1 + (rand() - 0.5) * 0.00004;
  return price * Math.exp(shock) * pull * jitter;
}
