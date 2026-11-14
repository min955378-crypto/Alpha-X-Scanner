'use client';

import { useEffect, useRef, useState } from 'react';

import { TF_TO_BINANCE, type Timeframe } from '@/lib/types';
import type { Candle } from '@/lib/indicators';

/**
 * §1.2  Live candle history + streaming for the Alpha X Native Sniper Chart.
 *
 * 1. Seed with 500 historical candles from our own API (which already prefers
 *    `data-api.binance.vision` and falls back to Bybit server-side, so the
 *    geo-block on `api.binance.com` never reaches the browser).
 * 2. Attach the public kline socket so the forming candle ticks every second.
 *
 * The socket is best-effort by design: if the browser cannot reach Binance
 * (corporate proxy, offline dev sandbox) the chart keeps rendering the seeded
 * history instead of failing, and `live` reports the real state.
 */

/** Public data mirrors, tried in order — never the geo-blocked api.binance.com. */
const WS_HOSTS = ['wss://data-stream.binance.vision:443', 'wss://stream.binance.com:9443'] as const;

export interface LiveCandles {
  candles: Candle[];
  loading: boolean;
  error: string | null;
  /** True while a kline socket is actively delivering ticks. */
  live: boolean;
  /** Where the seeded history came from. */
  source: 'engine' | 'upstream' | null;
}

interface KlinePayload {
  k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
}

export function useLiveCandles(symbol: string, tf: Timeframe, enabled = true): LiveCandles {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<'engine' | 'upstream' | null>(null);

  /* Guards against a slow seed resolving after the user switched symbol. */
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || !symbol) return;
    const id = ++requestId.current;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let hostIndex = 0;
    let disposed = false;

    setLoading(true);
    setError(null);
    setLive(false);
    setCandles([]);

    const lower = symbol.toLowerCase();
    const stream = `${lower}@kline_${TF_TO_BINANCE[tf]}`;

    const connect = () => {
      if (disposed || id !== requestId.current) return;
      const host = WS_HOSTS[hostIndex];
      if (!host) {
        /* Both mirrors unreachable — keep the seeded history, report offline. */
        setLive(false);
        return;
      }
      try {
        socket = new WebSocket(`${host}/ws/${stream}`);
      } catch {
        hostIndex += 1;
        connect();
        return;
      }

      socket.onopen = () => {
        if (disposed || id !== requestId.current) return;
        setLive(true);
        hostIndex = 0;
      };

      socket.onmessage = (ev) => {
        if (disposed || id !== requestId.current) return;
        let payload: KlinePayload;
        try {
          payload = JSON.parse(String(ev.data)) as KlinePayload;
        } catch {
          return;
        }
        const k = payload.k;
        if (!k) return;

        const bar: Candle = {
          t: k.t,
          o: Number(k.o),
          h: Number(k.h),
          l: Number(k.l),
          c: Number(k.c),
          v: Number(k.v),
          x: k.x,
        };
        if (!Number.isFinite(bar.c) || bar.c <= 0) return;

        setCandles((prev) => {
          if (!prev.length) return prev;
          const last = prev[prev.length - 1];
          /* Same bar → update in place. A closed bar rolls into a new one. */
          if (last.t === bar.t) {
            const next = prev.slice(0, -1);
            next.push(bar);
            return next;
          }
          if (bar.t > last.t) {
            const next = prev.concat(bar);
            return next.length > 520 ? next.slice(next.length - 520) : next;
          }
          return prev;
        });
      };

      socket.onerror = () => {
        /* Try the next mirror. */
      };

      socket.onclose = () => {
        if (disposed || id !== requestId.current) return;
        setLive(false);
        hostIndex += 1;
        if (hostIndex < WS_HOSTS.length) {
          reconnect = setTimeout(connect, 1200);
        }
      };
    };

    fetch(`/api/market/klines?symbol=${symbol}&tf=${tf}&limit=500`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ok: boolean; candles?: Candle[]; error?: string; source?: 'engine' | 'upstream' }) => {
        if (disposed || id !== requestId.current) return;
        if (j.ok && Array.isArray(j.candles) && j.candles.length) {
          setCandles(j.candles);
          setSource(j.source ?? null);
        } else {
          setError(j.error ?? 'NO_DATA');
        }
        setLoading(false);
        connect();
      })
      .catch(() => {
        if (disposed || id !== requestId.current) return;
        setError('NETWORK');
        setLoading(false);
        /* Still try the socket — it may work even if the REST seed failed. */
        connect();
      });

    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      if (socket) {
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          /* Already closing. */
        }
      }
    };
  }, [symbol, tf, enabled]);

  return { candles, loading, error, live, source };
}
