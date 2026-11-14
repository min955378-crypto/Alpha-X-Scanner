/**
 * Pure indicator math shared by the Global Quant Worker and any client-side
 * preview. Every function is deterministic and side-effect free so results are
 * byte-for-byte identical on both sides of the wire (spec §15.2).
 */

export interface Candle {
  /** Bar open time, epoch ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Quote volume (USDT) for the bar. */
  v: number;
  /** True once the bar is officially closed (`k.x === true`). */
  x: boolean;
}

/* -------------------------------------------------------------------------- */
/* §6.2  Wilder's RSI(14)                                                     */
/* -------------------------------------------------------------------------- */

export interface WilderState {
  avgGain: number;
  avgLoss: number;
  rsi: number;
}

/**
 * Seed Wilder's smoothing from the first `period + 1` closes using a simple
 * average of the initial gains/losses, then roll the recursive form.
 */
export function wilderRsiSeed(closes: number[], period = 14): WilderState {
  if (closes.length < 2) return { avgGain: 0, avgLoss: 0, rsi: 50 };

  let gain = 0;
  let loss = 0;
  const seedLen = Math.min(closes.length - 1, period);

  for (let i = 1; i <= seedLen; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }

  let avgGain = gain / seedLen;
  let avgLoss = loss / seedLen;

  for (let i = seedLen + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    const u = d > 0 ? d : 0;
    const dn = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + u) / period;
    avgLoss = (avgLoss * (period - 1) + dn) / period;
  }

  return { avgGain, avgLoss, rsi: rsiFromAverages(avgGain, avgLoss) };
}

export function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * §2.3  Intrabar RSI. The smoothed averages are NOT advanced here — they only
 * advance on an official candle close (`k.x === true`). This is what makes the
 * 1H RSI move smoothly every 60s exactly like TradingView's real-time value.
 */
export function wilderRsiIntrabar(state: WilderState, formingClose: number, prevClose: number, period = 14): number {
  const d = formingClose - prevClose;
  const u = d > 0 ? d : 0;
  const dn = d < 0 ? -d : 0;
  const avgGain = (state.avgGain * (period - 1) + u) / period;
  const avgLoss = (state.avgLoss * (period - 1) + dn) / period;
  return rsiFromAverages(avgGain, avgLoss);
}

export function wilderRsiAdvance(state: WilderState, close: number, prevClose: number, period = 14): WilderState {
  const d = close - prevClose;
  const u = d > 0 ? d : 0;
  const dn = d < 0 ? -d : 0;
  const avgGain = (state.avgGain * (period - 1) + u) / period;
  const avgLoss = (state.avgLoss * (period - 1) + dn) / period;
  return { avgGain, avgLoss, rsi: rsiFromAverages(avgGain, avgLoss) };
}

/* -------------------------------------------------------------------------- */
/* EMA / SMA / ATR                                                            */
/* -------------------------------------------------------------------------- */

export function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length);
  let prev = NaN;
  let seed = 0;
  const seedLen = Math.min(values.length, period);

  for (let i = 0; i < seedLen; i += 1) seed += values[i];
  prev = seed / seedLen;
  out[seedLen - 1] = prev;

  for (let i = seedLen; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  // Back-fill the SMA seed across the warmup window.
  for (let i = 0; i < seedLen - 1; i += 1) out[i] = prev;
  return out;
}

export function emaLast(values: number[], period: number): number {
  if (values.length === 0) return NaN;
  return emaSeries(values, period)[values.length - 1];
}

/** Streaming EMA update given the previous EMA value. */
export function emaNext(prevEma: number, value: number, period: number): number {
  const k = 2 / (period + 1);
  return value * k + prevEma * (1 - k);
}

export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const n = Math.min(values.length, period);
  let s = 0;
  for (let i = values.length - n; i < values.length; i += 1) s += values[i];
  return s / n;
}

/** Wilder's ATR(14). */
export function atrWilder(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const cur = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
  }
  if (trs.length === 0) return 0;
  const seedLen = Math.min(trs.length, period);
  let atr = 0;
  for (let i = 0; i < seedLen; i += 1) atr += trs[i];
  atr /= seedLen;
  for (let i = seedLen; i < trs.length; i += 1) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

/* -------------------------------------------------------------------------- */
/* §6.2  RVOL(20)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * RVOL_t = V_norm / SMA(V, 20) over the last 20 CLOSED bars.
 * V_norm = V_t * (bar_seconds / max(elapsed_seconds, 60)) — the 60s floor stops
 * artificial RVOL spikes during the first seconds of a new candle.
 */
export function rvol(formingVolume: number, closedVolumes: number[], barSeconds: number, elapsedSeconds: number): number {
  const avg = sma(closedVolumes, 20);
  if (avg <= 0) return 1;
  const denom = Math.max(elapsedSeconds, 60);
  const vNorm = formingVolume * (barSeconds / denom);
  return vNorm / avg;
}

/* -------------------------------------------------------------------------- */
/* Swing structure helpers (Order Block + Hidden Bullish scanners)             */
/* -------------------------------------------------------------------------- */

export interface SwingPoint {
  index: number;
  price: number;
}

/** Pivot highs with `left`/`right` confirmation bars. */
export function pivotHighs(candles: Candle[], left = 5, right = 5): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const h = candles[i].h;
    let isPivot = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j !== i && candles[j].h > h) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) out.push({ index: i, price: h });
  }
  return out;
}

export function pivotLows(candles: Candle[], left = 5, right = 5): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const l = candles[i].l;
    let isPivot = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j !== i && candles[j].l < l) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) out.push({ index: i, price: l });
  }
  return out;
}

/** Highest high over the last `n` bars (inclusive of the forming bar). */
export function highestHigh(candles: Candle[], n: number): number {
  let h = -Infinity;
  const start = Math.max(0, candles.length - n);
  for (let i = start; i < candles.length; i += 1) h = Math.max(h, candles[i].h);
  return h === -Infinity ? 0 : h;
}

export function lowestLow(candles: Candle[], n: number): number {
  let l = Infinity;
  const start = Math.max(0, candles.length - n);
  for (let i = start; i < candles.length; i += 1) l = Math.min(l, candles[i].l);
  return l === Infinity ? 0 : l;
}

/* -------------------------------------------------------------------------- */
/* Small numeric helpers                                                      */
/* -------------------------------------------------------------------------- */

export function pctDistance(a: number, b: number): number {
  if (b === 0) return 0;
  return ((a - b) / b) * 100;
}

export function candleRange(c: Candle): number {
  return Math.max(c.h - c.l, Number.EPSILON);
}

/** Body size as a fraction of the total candle range (0..1). */
export function bodyRatio(c: Candle): number {
  return Math.abs(c.c - c.o) / candleRange(c);
}

/** Lower-wick size as a fraction of the candle range (rejection wick test). */
export function lowerWickRatio(c: Candle): number {
  const bodyLo = Math.min(c.o, c.c);
  return (bodyLo - c.l) / candleRange(c);
}

export function upperWickRatio(c: Candle): number {
  const bodyHi = Math.max(c.o, c.c);
  return (c.h - bodyHi) / candleRange(c);
}
