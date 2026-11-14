import { TF_TO_BINANCE, type Timeframe } from '@/lib/types';
import type { Candle } from '@/lib/indicators';
import type { UniverseEntry } from './universe';

/**
 * §2  LIVE Binance data plane.
 *
 *   REST  GET /api/v3/exchangeInfo            -> universe (weight 20)
 *   REST  GET /api/v3/ticker/24hr             -> quotes    (weight 80 for the full book)
 *   REST  GET /api/v3/klines?limit=99         -> Phase A   (weight 1 per coin)
 *   REST  GET /api/v3/klines?limit=500        -> Phase B   (weight 5 per coin)
 *   WS    wss://stream.binance.com:9443/stream?streams=!miniTicker@arr
 *   WS    <symbol>@kline_<tf>                  (demand-driven, reference counted)
 *
 * Request weight is metered against a 1,200/min budget — 20% of Binance's
 * 6,000/min IP cap — so the WAF never sees us as abusive (§2.2).
 */

const REST = 'https://api.binance.com';
const WS_BASE = 'wss://stream.binance.com:9443/stream?streams=';
export const WEIGHT_CAP_PER_MIN = 1200;

/** §2.2  klines request weight depends on `limit`. */
export function klinesWeight(limit: number): number {
  if (limit <= 99) return 1;
  if (limit <= 499) return 2;
  return 5;
}

export class WeightMeter {
  private events: Array<{ t: number; w: number }> = [];
  /** Peak weight seen in the current minute — survives the 60s prune. */
  private peak = 0;
  private peakAt = 0;

  add(w: number): void {
    this.events.push({ t: Date.now(), w });
    const u = this.used();
    if (u > this.peak) {
      this.peak = u;
      this.peakAt = Date.now();
    }
  }

  /** Weight consumed in the trailing 60 seconds, floored at this minute's peak. */
  reported(): number {
    const u = this.used();
    if (Date.now() - this.peakAt > 60_000) return u;
    return Math.max(u, this.peak);
  }

  /** Weight consumed in the trailing 60 seconds. */
  used(): number {
    const cutoff = Date.now() - 60_000;
    this.events = this.events.filter((e) => e.t >= cutoff);
    return this.events.reduce((s, e) => s + e.w, 0);
  }

  headroom(): number {
    return Math.max(0, WEIGHT_CAP_PER_MIN - this.used());
  }
}

async function getJson(path: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${REST}${path}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Binance ${path} -> HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Returns null when Binance is unreachable (offline sandbox, WAF block, …). */
export async function probe(): Promise<boolean> {
  try {
    const res = (await getJson('/api/v3/ping', 5000)) as Record<string, unknown>;
    return Object.keys(res ?? {}).length === 0;
  } catch {
    return false;
  }
}

interface ExchangeInfoSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
}

export async function fetchUniverse(monitoring: Set<string>): Promise<UniverseEntry[] | null> {
  try {
    const payload = (await getJson('/api/v3/exchangeInfo')) as { symbols?: ExchangeInfoSymbol[] };
    const symbols = payload?.symbols ?? [];
    const out: UniverseEntry[] = [];
    for (const s of symbols) {
      if (s.quoteAsset !== 'USDT') continue;
      if (s.status !== 'TRADING' || !s.isSpotTradingAllowed) continue;
      if (/^(.*)(UP|DOWN|BULL|BEAR)$/.test(s.baseAsset)) continue;
      out.push({ symbol: s.symbol, baseAsset: s.baseAsset, isMonitoringTag: monitoring.has(s.baseAsset) });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export interface Ticker24 {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
}

export async function fetchTickers(): Promise<Map<string, Ticker24> | null> {
  try {
    const arr = (await getJson('/api/v3/ticker/24hr')) as Array<Record<string, string>>;
    const out = new Map<string, Ticker24>();
    for (const t of arr ?? []) {
      if (!t?.symbol) continue;
      out.set(t.symbol, {
        symbol: t.symbol,
        lastPrice: Number(t.lastPrice),
        priceChangePercent: Number(t.priceChangePercent),
        quoteVolume: Number(t.quoteVolume),
        highPrice: Number(t.highPrice),
        lowPrice: Number(t.lowPrice),
      });
    }
    return out.size ? out : null;
  } catch {
    return null;
  }
}

export async function fetchKlines(symbol: string, tf: Timeframe, limit: number): Promise<Candle[] | null> {
  try {
    const raw = (await getJson(
      `/api/v3/klines?symbol=${symbol}&interval=${TF_TO_BINANCE[tf]}&limit=${limit}`,
      10000,
    )) as unknown[][];
    if (!Array.isArray(raw)) return null;
    return raw.map((k) => ({
      t: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[7]), // quote asset volume
      x: Boolean(k[6] !== undefined ? true : true),
    }));
  } catch {
    return null;
  }
}

/**
 * Demand-driven kline stream pool (§2.3): one combined connection, streams
 * added/removed by reference count with a 15-minute idle grace period.
 */
export class KlineStreamPool {
  private counts = new Map<string, number>();
  private ws: WebSocket | null = null;
  private idleSince: Record<string, number> = {};
  private onMessage: (stream: string, data: unknown) => void;

  constructor(onMessage: (stream: string, data: unknown) => void) {
    this.onMessage = onMessage;
  }

  size(): number {
    return this.counts.size;
  }

  subscribe(streams: string[]): void {
    let changed = false;
    for (const s of streams) {
      const next = (this.counts.get(s) ?? 0) + 1;
      this.counts.set(s, next);
      if (next === 1) changed = true;
    }
    if (changed) this.reconnect();
  }

  unsubscribe(streams: string[]): void {
    let changed = false;
    for (const s of streams) {
      const next = (this.counts.get(s) ?? 0) - 1;
      if (next <= 0) {
        this.counts.delete(s);
        this.idleSince[s] = Date.now();
        changed = true;
      } else {
        this.counts.set(s, next);
      }
    }
    if (changed) this.reconnect();
  }

  private reconnect(): void {
    if (typeof WebSocket === 'undefined') return;
    const streams = [...this.counts.keys()];
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
    if (streams.length === 0) return;
    const url = `${WS_BASE}${streams.join('/')}`;
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as { stream?: string; data?: unknown };
        if (parsed.stream) this.onMessage(parsed.stream, parsed.data);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
    };
    this.ws = ws;
  }
}
