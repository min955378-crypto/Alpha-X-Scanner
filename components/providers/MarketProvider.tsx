'use client';

/** §2  Public market-data mirrors. `api.binance.com` is geo-blocked (HTTP
 *  451/403) from many cloud regions, so the vision data mirror is primary. */
const DIRECT_WS_HOSTS = ['wss://data-stream.binance.vision:443', 'wss://stream.binance.com:9443'] as const;

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';

import { decodeFrame, type WireFrame } from '@/lib/wire';
import { readSnapshot, writeSnapshot } from '@/lib/snapshot-cache';
import {
  SCANNERS,
  type BootStatus,
  type ClientMessage,
  type DataMode,
  type MarketFrame,
  type ScannerSignal,
  type ScannerSlug,
  type ServerMessage,
  type Timeframe,
} from '@/lib/types';
import { useToast } from './ToastProvider';

export type ConnectionStatus = 'connecting' | 'connected' | 'cached' | 'offline';

interface MarketApi {
  frame: MarketFrame | null;
  status: ConnectionStatus;
  dataMode: DataMode;
  boot: BootStatus | null;
  /** Seconds until the next 60s indicator cycle. */
  countdown: number;
  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  signals: Partial<Record<ScannerSlug, ScannerSignal[]>>;
  lastScanAt: Partial<Record<ScannerSlug, number>>;
  scanNow: (slug: ScannerSlug) => Promise<ScannerSignal[]>;
  /** 1 Hz price overlay: symbol -> [price, changePct24h]. */
  livePrices: MutableRefObject<Map<string, [number, number]>>;
  tickVersion: number;
  /** True while the browser holds its own live Binance price socket. */
  streamLive: boolean;
  subscribeScanners: (slugs: ScannerSlug[]) => void;
}

const Ctx = createContext<MarketApi | null>(null);

function wsUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/market`;
}

export function MarketProvider({
  children,
  initialTimeframe = '1H',
}: {
  children: ReactNode;
  initialTimeframe?: Timeframe;
}) {
  const { push } = useToast();

  /* §5.1  Paint the last known frame IMMEDIATELY — before the WebSocket even
     opens — so the heatmap, Pro Table, Coin Finder and all five scanners are
     populated on the first render instead of after a 30s cold start. */
  const [frame, setFrame] = useState<MarketFrame | null>(() => {
    const cached = readSnapshot();
    if (!cached) return null;
    try {
      return decodeFrame(cached.frame);
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<ConnectionStatus>(() => (readSnapshot() ? 'cached' : 'connecting'));
  const [dataMode, setDataMode] = useState<DataMode>('SIMULATED');
  const [boot, setBoot] = useState<BootStatus | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [timeframe, setTimeframeState] = useState<Timeframe>(initialTimeframe);
  const [signals, setSignals] = useState<Partial<Record<ScannerSlug, ScannerSignal[]>>>({});
  const [lastScanAt, setLastScanAt] = useState<Partial<Record<ScannerSlug, number>>>({});
  const [tickVersion, setTickVersion] = useState(0);
  /** True while the browser's direct Binance miniTicker socket is live. */
  const [streamLive, setStreamLive] = useState(false);

  const livePrices = useRef<Map<string, [number, number]>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const deadlineRef = useRef<number>(Date.now() + 60_000);
  const retryRef = useRef(0);
  const closedByUs = useRef(false);
  const timeframeRef = useRef<Timeframe>(initialTimeframe);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  /* ------------------------- message handling --------------------------- */

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'hello':
          setDataMode(msg.dataMode);
          setBoot(msg.boot);
          setStatus('connected');
          break;
        case 'frame': {
          const decoded = decodeFrame(msg.frame as unknown as WireFrame);
          setFrame(decoded);
          setDataMode(decoded.dataMode);
          setStatus('connected');
          /* §5.1  Keep the hot snapshot warm for the next login. */
          writeSnapshot(decoded.timeframe, msg.frame as unknown as WireFrame);
          deadlineRef.current = Date.now() + Math.max(5, decoded.nextUpdateSec) * 1000;
          setCountdown(Math.max(0, decoded.nextUpdateSec));
          for (const c of decoded.coins) livePrices.current.set(c.symbol, [c.price, c.changePct24h]);
          setTickVersion((v) => v + 1);
          break;
        }
        case 'tick': {
          for (const [symbol, price, change] of msg.u) livePrices.current.set(symbol, [price, change]);
          break;
        }
        case 'signals':
          setSignals((prev) => ({ ...prev, [msg.scannerSlug]: msg.signals }));
          setLastScanAt((prev) => ({ ...prev, [msg.scannerSlug]: Date.now() }));
          break;
        case 'boot':
          setBoot(msg.boot);
          break;
        case 'riskwatch':
          break;
        case 'access':
          break;
        case 'broadcast':
          /* An empty title is the admin clearing the banner. */
          if (msg.title) push({ title: msg.title, body: msg.body, level: msg.level === 'warn' ? 'warn' : 'info' });
          break;
        case 'pong':
          break;
        default:
          break;
      }
    },
    [push],
  );

  /* §5.1  Seed the live-price overlay from the hydrated snapshot so every tile
     renders a real number on the first frame rather than waiting for a tick. */
  useEffect(() => {
    if (!frame) return;
    for (const c of frame.coins) livePrices.current.set(c.symbol, [c.price, c.changePct24h]);
    setTickVersion((v) => v + 1);
  }, [frame]);

  /* ------------------------------ transport ----------------------------- */

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      setStatus('offline');
      return;
    }
    socketRef.current = ws;
    closedByUs.current = false;

    ws.onopen = () => {
      retryRef.current = 0;
      setStatus('connected');
      send({ type: 'subscribe', timeframe: timeframeRef.current });
    };

    ws.onmessage = (ev) => {
      try {
        handleMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      setStatus((s) => (s === 'connected' ? 'cached' : s));
    };

    ws.onclose = () => {
      socketRef.current = null;
      if (closedByUs.current) return;
      setStatus('cached');
      // §13  Exponential backoff with a hard ceiling.
      const delay = Math.min(15_000, 800 * 2 ** retryRef.current);
      retryRef.current += 1;
      setTimeout(connect, delay);
    };
  }, [handleMessage, send]);

  /* ----------------------- HTTP fallback (§13) -------------------------- */

  const pollOnce = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/frame?tf=${timeframeRef.current}`, { cache: 'no-store' });
      const data = (await res.json()) as { frame?: WireFrame; boot?: BootStatus; dataMode?: DataMode };
      if (data.frame) {
        const decoded = decodeFrame(data.frame);
        setFrame(decoded);
        setDataMode(decoded.dataMode);
        deadlineRef.current = Date.now() + 60_000;
        for (const c of decoded.coins) livePrices.current.set(c.symbol, [c.price, c.changePct24h]);
        setTickVersion((v) => v + 1);
      }
      if (data.boot) setBoot(data.boot);
      setStatus((s) => (s === 'connected' ? s : 'connected'));
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    connect();

    // If the socket has not produced a frame within 6s, fall back to polling.
    const guard = setTimeout(() => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        pollOnce();
        pollRef.current = setInterval(pollOnce, 8000);
      }
    }, 6000);

    return () => {
      clearTimeout(guard);
      if (pollRef.current) clearInterval(pollRef.current);
      closedByUs.current = true;
      socketRef.current?.close();
    };
  }, [connect, pollOnce]);

  /* ------------------------------ countdown ----------------------------- */

  useEffect(() => {
    const t = setInterval(() => {
      const remaining = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
      setCountdown(remaining);
      setTickVersion((v) => v + 1);
      // §13  Preserve last-good state and flag the badge when a frame is late.
      if (remaining === 0 && Date.now() - deadlineRef.current > 8000) {
        setStatus((s) => (s === 'offline' || streamLive ? s : 'cached'));
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* ------------------- §2  Direct Binance price stream ------------------- */

  /**
   * The browser connects straight to Binance's public miniTicker socket for
   * 1-second price and 24h-change updates.
   *
   * Why: the app's own WebSocket server cannot exist in a serverless
   * environment (Vercel runs each request in an isolated function), so on a
   * serverless deployment the socket below, not the app server, is what keeps
   * prices moving and the top-bar badge showing "● Connected".
   *
   * It never replaces the server frame — RSI / RVOL / ATR / Alpha Sniper are
   * computed server-side from klines — it only overlays the fastest-moving
   * fields on top of it.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let socket: WebSocket | null = null;
    let retry = 0;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let hostIndex = 0;
    let disposed = false;
    let flushAt = 0;

    const connect = () => {
      if (disposed) return;
      const host = DIRECT_WS_HOSTS[hostIndex];
      if (!host) return; // both mirrors exhausted — polling still covers us
      try {
        socket = new WebSocket(`${host}/ws/!miniTicker@arr`);
      } catch {
        hostIndex += 1;
        connect();
        return;
      }

      socket.onopen = () => {
        if (disposed) return;
        retry = 0;
        hostIndex = 0;
        setStreamLive(true);
      };

      socket.onmessage = (ev) => {
        if (disposed) return;
        let batch: Array<{ s?: string; c?: string; P?: string }>;
        try {
          batch = JSON.parse(String(ev.data)) as Array<{ s?: string; c?: string; P?: string }>;
        } catch {
          return;
        }
        if (!Array.isArray(batch)) return;

        for (const t of batch) {
          if (!t.s) continue;
          const price = Number(t.c);
          if (!Number.isFinite(price) || price <= 0) continue;
          livePrices.current.set(t.s, [price, Number(t.P) || 0]);
        }

        /* Re-render at ~1 Hz instead of on every one of ~600 messages. */
        const now = Date.now();
        if (now - flushAt >= 1000) {
          flushAt = now;
          setTickVersion((v) => v + 1);
          /* A live price feed is exactly what "Connected" means to the user. */
          setStatus((s) => (s === 'offline' ? s : 'connected'));
        }
      };

      socket.onerror = () => {
        /* Falls through to onclose, which handles the retry. */
      };

      socket.onclose = () => {
        if (disposed) return;
        setStreamLive(false);
        hostIndex += 1;
        if (hostIndex >= DIRECT_WS_HOSTS.length) {
          /* Full circuit: back off, then start again from the primary host. */
          hostIndex = 0;
          retry += 1;
        }
        reconnect = setTimeout(connect, Math.min(15_000, 800 * 2 ** retry));
      };
    };

    connect();

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
  }, []);

  /* -------------------------------- api --------------------------------- */

  const setTimeframe = useCallback(
    (tf: Timeframe) => {
      timeframeRef.current = tf;
      setTimeframeState(tf);
      send({ type: 'subscribe', timeframe: tf });
      void (async () => {
        const res = await fetch(`/api/market/frame?tf=${tf}`, { cache: 'no-store' });
        const data = (await res.json()) as { frame?: WireFrame };
        if (data.frame) setFrame(decodeFrame(data.frame));
      })();
    },
    [send],
  );

  const subscribeScanners = useCallback(
    (slugs: ScannerSlug[]) => {
      send({ type: 'subscribe', scanners: slugs });
    },
    [send],
  );

  const scanNow = useCallback(
    async (slug: ScannerSlug) => {
      const res = await fetch('/api/market/frame', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scannerSlug: slug }),
      });
      const data = (await res.json()) as { ok: boolean; signals?: ScannerSignal[] };
      if (data.ok && data.signals) {
        setSignals((prev) => ({ ...prev, [slug]: data.signals! }));
        setLastScanAt((prev) => ({ ...prev, [slug]: Date.now() }));
        return data.signals;
      }
      return [];
    },
    [],
  );

  // Ask for every scanner's channel up-front; the server gates by entitlement.
  useEffect(() => {
    if (status === 'connected') subscribeScanners(SCANNERS.map((s) => s.slug));
  }, [status, subscribeScanners]);

  const value = useMemo(
    () => ({
      frame,
      status,
      dataMode,
      boot,
      countdown,
      timeframe,
      setTimeframe,
      signals,
      lastScanAt,
      scanNow,
      livePrices,
      tickVersion,
      streamLive,
      subscribeScanners,
    }),
    [frame, status, dataMode, boot, countdown, timeframe, setTimeframe, signals, lastScanAt, scanNow, tickVersion, subscribeScanners],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMarket(): MarketApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMarket must be used inside <MarketProvider>');
  return ctx;
}
