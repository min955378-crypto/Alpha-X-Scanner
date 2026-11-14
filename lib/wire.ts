import type { CoinSnapshot, EmaStatus, MarketFrame, ObStatus } from './types';

/**
 * Compact wire encoding (spec §2.3).
 *
 * A full frame carries ~612 coins every 60 seconds. Long keys would triple the
 * payload, so each coin ships as a short-keyed record and is decoded back into
 * the ergonomic `CoinSnapshot` shape the UI consumes. Both sides of this
 * transform live in this one file so they can never drift.
 */

export const OB_CODES: ObStatus[] = ['NONE', 'DEMAND_BUY', 'SUPPLY_WAIT'];
export const EMA_CODES: EmaStatus[] = ['NONE', 'GOLDEN_9_21', 'DEATH_9_21', 'SNIPER_BUY', 'SNIPER_SELL'];

const FLAG_ENABLED = 1;
const FLAG_PERPETUAL = 2;
const FLAG_MONITORING = 4;

export interface WireCoin {
  s: string;
  p: number;
  c: number;
  v: number;
  hi: number;
  lo: number;
  sp: number;
  f: number | null;
  r: number;
  rp: number;
  rv: number;
  a: number;
  e9: number;
  e13: number;
  e21: number;
  e34: number;
  e50: number;
  as: number;
  asp: number;
  o: number;
  h: number;
  l: number;
  pc: number;
  ob: number;
  es: number;
  w5: number | null;
  ct: number;
  fl: number;
  /** §7.3  Score (0–100) — transmitted, never recomputed per-surface. */
  sc: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function encodeCoin(c: CoinSnapshot): WireCoin {
  return {
    s: c.symbol,
    p: r6(c.price),
    c: r2(c.changePct24h),
    v: Math.round(c.quoteVol24h),
    hi: r6(c.high24h),
    lo: r6(c.low24h),
    sp: r4(c.spreadPct),
    f: c.fundingRatePct === null ? null : r4(c.fundingRatePct),
    r: r2(c.rsi),
    rp: r2(c.rsiPrev),
    rv: r2(c.rvol),
    a: r6(c.atr),
    e9: r6(c.ema9),
    e13: r6(c.ema13),
    e21: r6(c.ema21),
    e34: r6(c.ema34),
    e50: r6(c.ema50),
    as: r2(c.alphaSniper),
    asp: r2(c.alphaSniperPrev),
    o: r6(c.open),
    h: r6(c.high),
    l: r6(c.low),
    pc: r6(c.prevClose),
    ob: Math.max(0, OB_CODES.indexOf(c.obStatus)),
    es: Math.max(0, EMA_CODES.indexOf(c.emaStatus)),
    w5: c.wr500 === null ? null : r2(c.wr500),
    ct: c.closedTrades500,
    sc: Math.max(0, Math.min(100, Math.round(c.score))),
    fl: (c.enabled ? FLAG_ENABLED : 0) | (c.hasPerpetual ? FLAG_PERPETUAL : 0) | (c.isMonitoringTag ? FLAG_MONITORING : 0),
  };
}

export function decodeCoin(w: WireCoin): CoinSnapshot {
  const fl = w.fl | 0;
  return {
    symbol: w.s,
    baseAsset: w.s.endsWith('USDT') ? w.s.slice(0, -4) : w.s,
    enabled: (fl & FLAG_ENABLED) !== 0,
    hasPerpetual: (fl & FLAG_PERPETUAL) !== 0,
    isMonitoringTag: (fl & FLAG_MONITORING) !== 0,
    price: w.p,
    changePct24h: w.c,
    quoteVol24h: w.v,
    high24h: w.hi,
    low24h: w.lo,
    spreadPct: w.sp,
    fundingRatePct: w.f,
    rsi: w.r,
    rsiPrev: w.rp,
    rsiDelta: Math.round((w.r - w.rp) * 100) / 100,
    rvol: w.rv,
    atr: w.a,
    atrPct: w.p > 0 ? (w.a / w.p) * 100 : 0,
    ema9: w.e9,
    ema13: w.e13,
    ema21: w.e21,
    ema34: w.e34,
    ema50: w.e50,
    alphaSniper: w.as,
    alphaSniperPrev: w.asp,
    open: w.o,
    high: w.h,
    low: w.l,
    prevClose: w.pc,
    obStatus: OB_CODES[w.ob] ?? 'NONE',
    emaStatus: EMA_CODES[w.es] ?? 'NONE',
    wr500: w.w5,
    closedTrades500: w.ct,
    score: w.sc,
  };
}

export interface WireFrame extends Omit<MarketFrame, 'coins'> {
  coins: WireCoin[];
}

export function encodeFrame(frame: MarketFrame): WireFrame {
  return { ...frame, coins: frame.coins.map(encodeCoin) };
}

export function decodeFrame(frame: WireFrame): MarketFrame {
  return { ...frame, coins: frame.coins.map(decodeCoin) };
}
