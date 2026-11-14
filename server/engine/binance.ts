import { TF_TO_BINANCE, type Timeframe } from '@/lib/types';
import type { Candle } from '@/lib/indicators';
import type { UniverseEntry } from './universe';

/**
 * §4  BULLETPROOF LIVE PUBLIC DATA PLANE.
 *
 * Design goals, in priority order:
 *   1. Never require an API key — everything below is unauthenticated.
 *   2. Never hard-fail on a geo-block. `api.binance.com` returns HTTP 451/403
 *      from many cloud regions, so `data-api.binance.vision` is the PRIMARY
 *      host (§4.1) and the legacy host is only a mirror.
 *   3. Never render an empty terminal. If every Binance host is unreachable we
 *      fall through to Bybit V5 and then CoinCap (§4.3).
 *
 *   REST   GET /api/v3/exchangeInfo            → universe
 *   REST   GET /api/v3/ticker/24hr             → quotes (price, 24h %, H/L,
 *                                                quote volume, bid-ask spread)
 *   REST   GET /api/v3/klines?limit=100|500    → warm-up / backtester
 *   WS     !miniTicker@arr                     → 1 Hz price + volume for all
 *   WS     <symbol>@kline_<tf>                 → on-demand candle stream
 *
 * Request weight is metered against a 1,200/min budget — 20% of Binance's
 * 6,000/min IP cap — so the WAF never sees us as abusive (§2.2).
 */

/* -------------------------------------------------------------------------- */
/* §4.1  Host registry — ordered by preference, not by alphabet.              */
/* -------------------------------------------------------------------------- */

export const REST_HOSTS: readonly string[] = [
  'https://data-api.binance.vision', // PRIMARY — public data mirror, no geo-block
  'https://api.binance.com', // mirror — 451/403 in some cloud regions
];

/** §4.2  WebSocket hosts, same ordering. */
export const WS_HOSTS: readonly string[] = [
  'wss://data-stream.binance.vision:443',
  'wss://stream.binance.com:9443',
];

/** §4.3  Cross-exchange fallbacks, tried only when every Binance host fails. */
export const FALLBACK_CHAIN = ['binance', 'bybit', 'coincap'] as const;
export type ProviderId = (typeof FALLBACK_CHAIN)[number];

export const WEIGHT_CAP_PER_MIN = 1200;

/** §2.2  klines request weight depends on `limit`. */
export function klinesWeight(limit: number): number {
  if (limit <= 99) return 1;
  if (limit <= 499) return 2;
  return 5;
}

/* -------------------------------------------------------------------------- */
/* Weight metering                                                            */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Transport — sticky host selection with automatic failover                   */
/* -------------------------------------------------------------------------- */

/** Hosts are re-probed at most once every 60s so a dead mirror isn't retried. */
const HOST_COOLDOWN_MS = 60_000;

interface HostState {
  failures: number;
  downUntil: number;
}

const hostState = new Map<string, HostState>();

function stateOf(host: string): HostState {
  let s = hostState.get(host);
  if (!s) {
    s = { failures: 0, downUntil: 0 };
    hostState.set(host, s);
  }
  return s;
}

function isDown(host: string): boolean {
  return stateOf(host).downUntil > Date.now();
}

function markDown(host: string): void {
  const s = stateOf(host);
  s.failures += 1;
  /* Exponential backoff capped at the cooldown window. */
  s.downUntil = Date.now() + Math.min(HOST_COOLDOWN_MS, 1000 * 2 ** Math.min(s.failures, 6));
}

/**
 * Test seam: clears the sticky host backoff so a suite can exercise a clean
 * failover ladder. Not called by production code.
 */
export function resetHostState(): void {
  hostState.clear();
  restCursor = 0;
  activeProvider = 'NONE';
}

function markUp(host: string): void {
  const s = stateOf(host);
  s.failures = 0;
  s.downUntil = 0;
}

/** Index of the currently-preferred REST host (sticky until it fails). */
let restCursor = 0;

/** Which provider actually served the last successful call — surfaced to /health. */
export let activeProvider: ProviderId | 'NONE' = 'NONE';

export function activeProviderId(): ProviderId | 'NONE' {
  return activeProvider;
}

async function getJsonFrom(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'Alpha X Scanner/2.5 (+https://alpha-x-scanner.com)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * §4.1  Try every Binance REST host in order, remembering which one worked so
 * subsequent calls skip the dead ones. Returns null only when all are down.
 */
async function getJson(path: string, timeoutMs = 8000): Promise<unknown> {
  const order = REST_HOSTS.map((_, i) => (restCursor + i) % REST_HOSTS.length);

  for (const idx of order) {
    const host = REST_HOSTS[idx];
    if (isDown(host)) continue;
    try {
      const data = await getJsonFrom(`${host}${path}`, timeoutMs);
      markUp(host);
      restCursor = idx;
      activeProvider = 'binance';
      return data;
    } catch {
      markDown(host);
    }
  }
  return null;
}

/** Returns true when ANY configured upstream answers. */
export async function probe(): Promise<boolean> {
  for (const host of REST_HOSTS) {
    if (isDown(host)) continue;
    try {
      await getJsonFrom(`${host}/api/v3/ping`, 5000);
      markUp(host);
      activeProvider = 'binance';
      return true;
    } catch {
      markDown(host);
    }
  }
  /* §4.3  Binance unreachable — verify a fallback is alive instead. */
  try {
    const coins = await fetchCoincapFallback();
    if (coins && coins.size) {
      activeProvider = 'coincap';
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Universe                                                                    */
/* -------------------------------------------------------------------------- */

interface ExchangeInfoSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
}

export async function fetchUniverse(monitoring: Set<string>): Promise<UniverseEntry[] | null> {
  try {
    const payload = (await getJson('/api/v3/exchangeInfo')) as { symbols?: ExchangeInfoSymbol[] } | null;
    const symbols = (payload as { symbols?: ExchangeInfoSymbol[] } | null)?.symbols ?? [];
    const out: UniverseEntry[] = [];
    for (const s of symbols) {
      if (s.quoteAsset !== 'USDT') continue;
      if (s.status !== 'TRADING' || !s.isSpotTradingAllowed) continue;
      /* §4.1  Strip leveraged tokens (*UP/*DOWN/*BULL/*BEAR). */
      if (/^(.*)(UP|DOWN|BULL|BEAR)$/.test(s.baseAsset)) continue;
      out.push({ symbol: s.symbol, baseAsset: s.baseAsset, isMonitoringTag: monitoring.has(s.baseAsset) });
    }
    if (out.length) return out;
  } catch {
    /* fall through to Bybit */
  }

  /* §4.3  Fallback 1 — Bybit V5 spot instruments. */
  const bybit = await fetchBybitUniverse(monitoring);
  if (bybit) return bybit;

  /* §4.3  Fallback 2 — CoinCap asset list (USDT-quoted by convention). */
  const coincap = await fetchCoincapFallback();
  if (coincap && coincap.size) {
    return [...coincap.keys()]
      .map((symbol) => symbol.replace(/USDT$/, ''))
      .filter((base) => base && !/^(.*)(UP|DOWN|BULL|BEAR)$/.test(base))
      .map((baseAsset) => ({
        symbol: `${baseAsset}USDT`,
        baseAsset,
        isMonitoringTag: monitoring.has(baseAsset),
      }));
  }
  return null;
}

interface BybitTickerRow {
  symbol?: string;
  lastPrice?: string;
  price24hPcnt?: string;
  turnover24h?: string;
  highPrice24h?: string;
  lowPrice24h?: string;
  bid1Price?: string;
  ask1Price?: string;
}

async function fetchBybitUniverse(monitoring: Set<string>): Promise<UniverseEntry[] | null> {
  try {
    const payload = (await getJsonFrom(
      'https://api.bybit.com/v5/market/tickers?category=spot',
      8000,
    )) as { result?: { list?: BybitTickerRow[] } };
    const rows = payload?.result?.list ?? [];
    const out: UniverseEntry[] = [];
    for (const r of rows) {
      if (!r.symbol || !r.symbol.endsWith('USDT')) continue;
      const baseAsset = r.symbol.replace(/USDT$/, '');
      if (/^(.*)(UP|DOWN|BULL|BEAR)$/.test(baseAsset)) continue;
      out.push({ symbol: r.symbol, baseAsset, isMonitoringTag: monitoring.has(baseAsset) });
    }
    if (!out.length) return null;
    activeProvider = 'bybit';
    return out;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Tickers                                                                     */
/* -------------------------------------------------------------------------- */

export interface Ticker24 {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
  /** §4.1  Bid-ask spread in price units — a live liquidity proxy. */
  bidPrice: number;
  askPrice: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * §4.1/§4.3  One call returns live price, 24h change, 24h high/low, 24h quote
 * volume and bid-ask spread for every symbol. Falls back Bybit → CoinCap.
 */
export async function fetchTickers(): Promise<Map<string, Ticker24> | null> {
  /* Primary — Binance public data mirror. */
  try {
    const arr = (await getJson('/api/v3/ticker/24hr')) as Array<Record<string, string>> | null;
    if (Array.isArray(arr) && arr.length) {
      const out = new Map<string, Ticker24>();
      for (const t of arr) {
        if (!t?.symbol) continue;
        const bid = num(t.bidPrice);
        const ask = num(t.askPrice);
        out.set(t.symbol, {
          symbol: t.symbol,
          lastPrice: num(t.lastPrice),
          priceChangePercent: num(t.priceChangePercent),
          quoteVolume: num(t.quoteVolume),
          highPrice: num(t.highPrice),
          lowPrice: num(t.lowPrice),
          bidPrice: bid,
          askPrice: ask,
        });
      }
      if (out.size) return out;
    }
  } catch {
    /* fall through */
  }

  /* §4.3  Fallback 1 — Bybit V5 spot tickers. */
  try {
    const payload = (await getJsonFrom('https://api.bybit.com/v5/market/tickers?category=spot', 8000)) as {
      result?: { list?: BybitTickerRow[] };
    };
    const rows = payload?.result?.list ?? [];
    if (rows.length) {
      const out = new Map<string, Ticker24>();
      for (const r of rows) {
        if (!r.symbol) continue;
        const last = num(r.lastPrice);
        out.set(r.symbol, {
          symbol: r.symbol,
          lastPrice: last,
          /* Bybit returns a ratio (0.0312 = +3.12%); Binance returns a percent. */
          priceChangePercent: num(r.price24hPcnt) * 100,
          quoteVolume: num(r.turnover24h),
          highPrice: num(r.highPrice24h),
          lowPrice: num(r.lowPrice24h),
          bidPrice: num(r.bid1Price),
          askPrice: num(r.ask1Price),
        });
      }
      if (out.size) {
        activeProvider = 'bybit';
        return out;
      }
    }
  } catch {
    /* fall through */
  }

  /* §4.3  Fallback 2 — CoinCap, so the terminal never shows empty zones. */
  const coincap = await fetchCoincapFallback();
  return coincap;
}

interface CoincapAsset {
  symbol?: string;
  priceUsd?: string;
  changePercent24Hr?: string;
  volumeUsd24Hr?: string;
}

async function fetchCoincapFallback(): Promise<Map<string, Ticker24> | null> {
  try {
    const payload = (await getJsonFrom('https://api.coincap.io/v2/assets?limit=2000', 8000)) as {
      data?: CoincapAsset[];
    };
    const rows = payload?.data ?? [];
    if (!rows.length) return null;

    const out = new Map<string, Ticker24>();
    for (const a of rows) {
      const base = (a.symbol ?? '').toUpperCase();
      if (!base) continue;
      const price = num(a.priceUsd);
      /* CoinCap has no 24h high/low — derive a symmetric band around spot so
         downstream RVOL/ATR math has finite inputs rather than NaN. */
      const change = num(a.changePercent24Hr);
      const prev = price / (1 + change / 100 || 1);
      out.set(`${base}USDT`, {
        symbol: `${base}USDT`,
        lastPrice: price,
        priceChangePercent: change,
        quoteVolume: num(a.volumeUsd24Hr),
        highPrice: Math.max(price, prev),
        lowPrice: Math.min(price, prev),
        bidPrice: price,
        askPrice: price,
      });
    }
    if (!out.size) return null;
    activeProvider = 'coincap';
    return out;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Klines                                                                      */
/* -------------------------------------------------------------------------- */

/** §4.3  Bybit interval codes (minutes), keyed by our timeframe labels. */
const TF_TO_BYBIT: Record<string, string> = {
  '15m': '15',
  '30m': '30',
  '1H': '60',
  '4H': '240',
  '1D': 'D',
};

export async function fetchKlines(symbol: string, tf: Timeframe, limit: number): Promise<Candle[] | null> {
  /* Primary — Binance public data mirror. */
  try {
    const raw = (await getJson(
      `/api/v3/klines?symbol=${symbol}&interval=${TF_TO_BINANCE[tf]}&limit=${limit}`,
      10000,
    )) as unknown[][] | null;
    if (Array.isArray(raw) && raw.length) {
      return raw.map((k) => ({
        t: Number(k[0]),
        o: Number(k[1]),
        h: Number(k[2]),
        l: Number(k[3]),
        c: Number(k[4]),
        v: Number(k[7]), // quote asset volume
        x: true,
      }));
    }
  } catch {
    /* fall through */
  }

  /* §4.3  Fallback 1 — Bybit V5 klines (returned newest-first). */
  const interval = TF_TO_BYBIT[tf];
  if (interval) {
    try {
      const payload = (await getJsonFrom(
        `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}`,
        10000,
      )) as { result?: { list?: unknown[][] } };
      const rows = payload?.result?.list ?? [];
      if (rows.length) {
        const out = rows
          .map((k) => ({
            t: Number(k[0]),
            o: Number(k[1]),
            h: Number(k[2]),
            l: Number(k[3]),
            c: Number(k[4]),
            v: Number(k[6]),
            x: true,
          }))
          .sort((a, b) => a.t - b.t);
        activeProvider = 'bybit';
        return out;
      }
    } catch {
      /* fall through */
    }
  }

  /* §4.3  CoinCap exposes no OHLC history — the simulated feed takes over. */
  return null;
}

/* -------------------------------------------------------------------------- */
/* §4.2  WebSocket stream pool with host failover                              */
/* -------------------------------------------------------------------------- */

/**
 * Demand-driven kline stream pool: one combined connection, streams added /
 * removed by reference count, and — new in §4.2 — automatic promotion to the
 * next WebSocket host whenever the current one drops.
 */
export class KlineStreamPool {
  private counts = new Map<string, number>();
  private ws: WebSocket | null = null;
  private idleSince: Record<string, number> = {};
  private onMessage: (stream: string, data: unknown) => void;
  private hostIdx = 0;
  private retryAt: NodeJS.Timeout | null = null;
  private closed = false;

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

  destroy(): void {
    this.closed = true;
    if (this.retryAt) clearTimeout(this.retryAt);
    this.retryAt = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }

  private reconnect(): void {
    if (typeof WebSocket === 'undefined') return;
    if (this.retryAt) {
      clearTimeout(this.retryAt);
      this.retryAt = null;
    }

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

    const host = WS_HOSTS[this.hostIdx % WS_HOSTS.length];
    const url = `${host}/stream?streams=${streams.join('/')}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleFailover();
      return;
    }

    let opened = false;
    ws.onopen = () => {
      opened = true;
      activeProvider = 'binance';
    };
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as { stream?: string; data?: unknown };
        if (parsed.stream) this.onMessage(parsed.stream, parsed.data);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => {
      /* onerror is always followed by onclose — failover happens there. */
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      if (!opened) this.scheduleFailover();
      else if (this.counts.size) this.scheduleFailover(1000);
    };

    this.ws = ws;
  }

  /** §4.2  Walk to the next WS host on the next tick, with backoff. */
  private scheduleFailover(delayMs = 250): void {
    if (this.closed || this.retryAt) return;
    this.hostIdx = (this.hostIdx + 1) % WS_HOSTS.length;
    this.retryAt = setTimeout(() => {
      this.retryAt = null;
      if (!this.closed && this.counts.size) this.reconnect();
    }, delayMs);
    /* Unref so a pending retry never holds the process open. */
    this.retryAt.unref?.();
  }
}

/**
 * §4.2  `!miniTicker@arr` — 1-second price, volume and intrabar updates for
 * every symbol on a SINGLE connection, costing zero REST weight.
 */
export class MiniTickerStream {
  private ws: WebSocket | null = null;
  private hostIdx = 0;
  private retryAt: NodeJS.Timeout | null = null;
  private closed = false;
  private onMessage: (rows: MiniTickerRow[]) => void;

  constructor(onMessage: (rows: MiniTickerRow[]) => void) {
    this.onMessage = onMessage;
  }

  start(): void {
    this.connect();
  }

  destroy(): void {
    this.closed = true;
    if (this.retryAt) clearTimeout(this.retryAt);
    this.retryAt = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.closed || typeof WebSocket === 'undefined') return;
    const host = WS_HOSTS[this.hostIdx % WS_HOSTS.length];
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${host}/stream?streams=!miniTicker@arr`);
    } catch {
      this.scheduleFailover();
      return;
    }

    let opened = false;
    ws.onopen = () => {
      opened = true;
      activeProvider = 'binance';
    };
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as { data?: MiniTickerRow[] };
        if (Array.isArray(parsed.data)) this.onMessage(parsed.data);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      this.scheduleFailover(opened ? 1000 : 250);
    };
    ws.onerror = () => {
      /* handled by onclose */
    };
    this.ws = ws;
  }

  private scheduleFailover(delayMs = 500): void {
    if (this.closed || this.retryAt) return;
    this.hostIdx = (this.hostIdx + 1) % WS_HOSTS.length;
    this.retryAt = setTimeout(() => {
      this.retryAt = null;
      if (!this.closed) this.connect();
    }, delayMs);
    this.retryAt.unref?.();
  }
}

/** §4.2  One `!miniTicker@arr` entry. */
export interface MiniTickerRow {
  /** Event type — `24hrMiniTicker`. */
  e?: string;
  s?: string;
  c?: string;
  o?: string;
  h?: string;
  l?: string;
  /** Total traded base-asset volume. */
  v?: string;
  /** Total traded quote-asset volume. */
  q?: string;
}
