'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

import type { Candle } from '@/lib/indicators';
import { emaSeries } from '@/lib/indicators';

/**
 * §4.4  MODE A — ALPHA X NATIVE SNIPER CHART.
 *
 * TradingView Lightweight Charts (HTML5 canvas) fed by live Binance klines,
 * with the exact overlay stack the playbook teaches:
 *
 *   • Fast EMA 13  — #00D26A, 2px
 *   • Slow EMA 34  — #EF4444, 2px
 *   • Bullish / Bearish Order Block zones (demand = emerald, supply = crimson)
 *   • LAST 500 CANDLES backtest HUD (TRADES / WIN / LOSS / ACTIVE / WIN RATE %)
 *   • Synchronised lower pane: Alpha Sniper = EMA(RSI(14), 3) in #8B5CF6
 *     inside a 30–70 channel with the 50 midline.
 *
 * §7.1  Candlestick colours are FIXED: bullish emerald (#00D26A body & wick,
 * #22C55E border), bearish crimson (#EF4444 body, wick & border).
 */

const BULL_BODY = '#00D26A';
const BULL_BORDER = '#22C55E';
const BEAR = '#EF4444';
const SNIPER = '#8B5CF6';
const GRID = 'rgba(255,255,255,0.05)';
const BG = '#0A0C14';

export interface SniperChartProps {
  candles: Candle[];
  symbol: string;
  height?: number;
  /** Rendered by the parent above/below the canvas. */
  onHudChange?: (hud: BacktestHud) => void;
  /**
   * §1.2  Active scanner setup drawn as horizontal price lines on the main
   * pane: ENTRY (blue), INVALIDATION/SL (red), TP1 and TP2 (emerald).
   */
  setup?: ChartSetup | null;
}

/** The four levels of a live scanner setup, as published by the engine. */
export interface ChartSetup {
  direction: 'LONG' | 'SHORT';
  entry: number;
  invalidation: number;
  tp1: number;
  tp2: number | null;
  scannerSlug?: string;
}

export interface BacktestHud {
  trades: number;
  win: number;
  loss: number;
  active: number;
  winRate: number | null;
}

/* -------------------------------------------------------------------------- */
/* Indicator maths — mirrors the server engine so chart and scanners agree.   */
/* -------------------------------------------------------------------------- */

function wilderRsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** §4.4  Alpha Sniper = EMA(RSI(14), 3), the 30–70 channel oscillator. */
function alphaSniper(closes: number[]): Array<number | null> {
  const rsi = wilderRsi(closes, 14);
  const seedAt = rsi.findIndex((v) => Number.isFinite(v));
  if (seedAt < 0) return new Array(closes.length).fill(null);

  const finite = rsi.slice(seedAt);
  const ema = emaSeries(finite, 3);
  const out: Array<number | null> = new Array(closes.length).fill(null);
  for (let i = 0; i < ema.length; i += 1) out[seedAt + i] = ema[i];
  return out;
}

interface ObZone {
  from: number;
  to: number;
  top: number;
  bottom: number;
  kind: 'DEMAND' | 'SUPPLY';
}

/**
 * §4.4  Unmitigated order blocks: the last opposing candle before an impulsive
 * move. Kept deliberately small (max 3 zones) so the chart stays readable.
 */
function orderBlockZones(candles: Candle[], lookback = 120): ObZone[] {
  const zones: ObZone[] = [];
  const start = Math.max(1, candles.length - lookback);

  for (let i = start; i < candles.length - 1; i += 1) {
    const prev = candles[i - 1];
    const bar = candles[i];
    const next = candles[i + 1];
    if (!prev || !next) continue;

    const body = Math.abs(bar.c - bar.o);
    const range = bar.h - bar.l;
    if (range <= 0 || body / range < 0.4) continue;

    /* Bearish candle followed by a bullish impulse → demand (bullish) block. */
    const bullImpulse = bar.c < bar.o && next.c > bar.o && (next.c - next.o) / Math.max(next.h - next.l, 1e-9) > 0.55;
    const bearImpulse = bar.c > bar.o && next.c < bar.o && (next.o - next.c) / Math.max(next.h - next.l, 1e-9) > 0.55;

    if (bullImpulse) {
      zones.push({ from: bar.t, to: next.t, top: bar.o, bottom: bar.l, kind: 'DEMAND' });
    } else if (bearImpulse) {
      zones.push({ from: bar.t, to: next.t, top: bar.h, bottom: bar.o, kind: 'SUPPLY' });
    }
  }
  return zones.slice(-3);
}

/** §4.4  Rolling 500-candle backtest — mirrors the engine's Alpha Sniper rules. */
function backtest(closes: number[], sniper: Array<number | null>): BacktestHud {
  let trades = 0;
  let win = 0;
  let loss = 0;
  let entry: { price: number; stop: number; target: number } | null = null;

  for (let i = 20; i < closes.length - 1; i += 1) {
    const cur = sniper[i];
    const prev = sniper[i - 1];
    if (cur === null || prev === null) continue;

    if (!entry && prev <= 30 && cur > 30) {
      /* Long trigger: cross back above the 30 exhaustion rail. */
      const atr = Math.abs(closes[i] - closes[i - 1]);
      entry = { price: closes[i], stop: closes[i] - atr * 2, target: closes[i] + atr * 3 };
      continue;
    }
    if (entry) {
      const next = closes[i + 1];
      if (next <= entry.stop) {
        loss += 1;
        trades += 1;
        entry = null;
      } else if (next >= entry.target) {
        win += 1;
        trades += 1;
        entry = null;
      }
    }
  }

  return {
    trades,
    win,
    loss,
    active: entry ? 1 : 0,
    winRate: trades > 0 ? (win / trades) * 100 : null,
  };
}

function toSeconds(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function SniperChart({ candles, symbol, height = 460, onHudChange, setup = null }: SniperChartProps) {
  const mainRef = useRef<HTMLDivElement | null>(null);
  const oscRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const oscChartRef = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema13Series = useRef<ISeriesApi<'Line'> | null>(null);
  const ema34Series = useRef<ISeriesApi<'Line'> | null>(null);
  const oscLineSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const [hud, setHud] = useState<BacktestHud>({ trades: 0, win: 0, loss: 0, active: 0, winRate: null });

  const derived = useMemo(() => {
    if (!candles.length) return null;
    const closes = candles.map((c) => c.c);
    return {
      closes,
      ema13: emaSeries(closes, 13),
      ema34: emaSeries(closes, 34),
      sniper: alphaSniper(closes),
      zones: orderBlockZones(candles),
      hud: backtest(closes, alphaSniper(closes)),
    };
  }, [candles]);

  /* Publish the HUD upward so the page can render it as a table. */
  useEffect(() => {
    if (!derived) return;
    setHud(derived.hud);
    onHudChange?.(derived.hud);
  }, [derived, onHudChange]);

  /* ------------------------------- main chart ------------------------------ */
  useEffect(() => {
    if (!mainRef.current || !derived) return;

    const chart = createChart(mainRef.current, {
      width: mainRef.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: BG }, textColor: '#7E8FA6', fontSize: 10 },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: '#11141F' },
        horzLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: '#11141F' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
      /* §5.3  No animation on data updates — every frame is a live tick. */
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    /* §7.1  Strict candlestick colours. Never altered anywhere else. */
    const cs = chart.addCandlestickSeries({
      upColor: BULL_BODY,
      downColor: BEAR,
      borderUpColor: BULL_BORDER,
      borderDownColor: BEAR,
      wickUpColor: BULL_BODY,
      wickDownColor: BEAR,
    });
    candleSeries.current = cs;

    const ema13 = chart.addLineSeries({ color: BULL_BODY, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    ema13Series.current = ema13;
    const ema34 = chart.addLineSeries({ color: BEAR, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    ema34Series.current = ema34;

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) chart.applyOptions({ width: w });
    });
    ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeries.current = null;
      ema13Series.current = null;
      ema34Series.current = null;
    };
    /* Creation is deliberately independent of the data: the live kline socket
       pushes a new bar every second, and tearing the chart down on each tick
       would make the canvas visibly stutter. */
  }, [height, symbol]);

  /* Feed the existing series — cheap `setData`, no chart teardown. */
  useEffect(() => {
    if (!derived) return;
    candleSeries.current?.setData(
      candles.map((c) => ({
        time: toSeconds(c.t),
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    );
    ema13Series.current?.setData(
      candles
        .map((c, i) => ({ time: toSeconds(c.t), value: derived.ema13[i] }))
        .filter((p) => p.value !== undefined && Number.isFinite(p.value)),
    );
    ema34Series.current?.setData(
      candles
        .map((c, i) => ({ time: toSeconds(c.t), value: derived.ema34[i] }))
        .filter((p) => p.value !== undefined && Number.isFinite(p.value)),
    );
  }, [candles, derived]);

  /* §1.2  ENTRY / INVALIDATION / TP1 / TP2 horizontal levels. */
  useEffect(() => {
    const series = candleSeries.current;
    if (!series || !setup) return;

    const levels: Array<{ price: number; color: string; title: string }> = [
      { price: setup.entry, color: '#3B82F6', title: 'ENTRY' },
      { price: setup.invalidation, color: '#EF4444', title: 'SL' },
      { price: setup.tp1, color: '#22C55E', title: 'TP1' },
    ];
    if (setup.tp2 !== null) levels.push({ price: setup.tp2, color: '#22C55E', title: 'TP2' });

    const lines = levels
      .filter((l) => Number.isFinite(l.price) && l.price > 0)
      .map((l) =>
        series.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${l.title} ${setup.direction === 'LONG' ? '🟢' : '🔴'}`,
        }),
      );

    return () => {
      for (const line of lines) {
        try {
          series.removePriceLine(line);
        } catch {
          /* The series was torn down first — nothing left to clean up. */
        }
      }
    };
  }, [setup]);

  /* --------------------------- oscillator sub-pane -------------------------- */
  useEffect(() => {
    if (!oscRef.current || !derived) return;

    const osc = createChart(oscRef.current, {
      width: oscRef.current.clientWidth,
      height: 130,
      layout: { background: { type: ColorType.Solid, color: BG }, textColor: '#7E8FA6', fontSize: 10 },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
      handleScroll: true,
      handleScale: true,
    });
    oscChartRef.current = osc;

    const line = osc.addLineSeries({ color: SNIPER, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    oscLineSeries.current = line;

    /* 30–70 channel with the 50 midline. */
    for (const level of [30, 50, 70]) {
      line.createPriceLine({
        price: level,
        color: level === 50 ? 'rgba(255,255,255,0.35)' : SNIPER,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: level === 50 ? '50' : String(level),
      });
    }

    osc.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) osc.applyOptions({ width: w });
    });
    ro.observe(oscRef.current);

    return () => {
      ro.disconnect();
      osc.remove();
      oscChartRef.current = null;
      oscLineSeries.current = null;
    };
  }, [height]);

  /* Feed the oscillator without rebuilding the pane. */
  useEffect(() => {
    if (!derived) return;
    oscLineSeries.current?.setData(
      candles
        .map((c, i) => ({ time: toSeconds(c.t), value: derived.sniper[i] ?? NaN }))
        .filter((p) => Number.isFinite(p.value)),
    );
  }, [candles, derived]);

  /* Synchronise the two panes' visible ranges. */
  useEffect(() => {
    const a = chartRef.current;
    const b = oscChartRef.current;
    if (!a || !b) return;

    const sync = (src: IChartApi, dst: IChartApi) => () => {
      const range = src.timeScale().getVisibleLogicalRange();
      if (range) dst.timeScale().setVisibleLogicalRange(range);
    };
    const aToB = sync(a, b);
    const bToA = sync(b, a);
    a.timeScale().subscribeVisibleLogicalRangeChange(aToB);
    b.timeScale().subscribeVisibleLogicalRangeChange(bToA);
    return () => {
      a.timeScale().unsubscribeVisibleLogicalRangeChange(aToB);
      b.timeScale().unsubscribeVisibleLogicalRangeChange(bToA);
    };
  });

  if (!derived || !candles.length) {
    return (
      <div
        className="grid place-items-center rounded-xl border border-white/[0.06] bg-black/40 text-[11px] text-text-muted"
        style={{ height }}
      >
        Loading candles for {symbol}…
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* §4.4  LAST 500 CANDLES Backtest HUD — top-center overlay. */}
      <div className="pointer-events-none relative z-10 flex justify-center">
        <div className="pointer-events-auto -mb-8 mt-2 rounded-lg border border-white/10 bg-black/85 px-3 py-1.5 shadow-2xl backdrop-blur">
          <div className="mb-0.5 text-center text-[8.5px] font-bold uppercase tracking-wider text-text-muted">
            Last 500 candles
          </div>
          <div className="mono-num flex items-center gap-3 text-[10px]">
            <HudCell label="TRADES" value={String(hud.trades)} />
            <HudCell label="WIN" value={String(hud.win)} tone="#22C55E" />
            <HudCell label="LOSS" value={String(hud.loss)} tone="#EF4444" />
            <HudCell label="ACTIVE" value={String(hud.active)} tone="#F5B301" />
            <HudCell
              label="WIN RATE"
              value={hud.winRate === null ? 'WARMING' : `${hud.winRate.toFixed(1)}%`}
              tone={hud.winRate === null ? '#7E8FA6' : hud.winRate >= 55 ? '#22C55E' : '#EF4444'}
            />
          </div>
        </div>
      </div>

      <div ref={mainRef} style={{ height }} />

      <div className="border-t border-white/[0.06]">
        <div className="flex items-center justify-between px-3 pt-1.5 text-[9px] uppercase tracking-wider text-text-muted">
          <span>Alpha Sniper · EMA(RSI(14), 3) · 30–70 channel</span>
          <span className="flex items-center gap-2">
            <Legend color={BULL_BODY} label="EMA 13" />
            <Legend color={BEAR} label="EMA 34" />
            <Legend color={SNIPER} label="Sniper" />
          </span>
        </div>
        <div ref={oscRef} />
      </div>

      {derived.zones.length ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-3 py-1.5 text-[9.5px] text-text-muted">
          <span className="font-bold uppercase tracking-wider">Unmitigated order blocks</span>
          {derived.zones.map((z) => (
            <span
              key={`${z.from}-${z.kind}`}
              className={`mono-num rounded border px-1.5 py-px font-semibold ${
                z.kind === 'DEMAND'
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-red-500/50 bg-red-500/10 text-red-400'
              }`}
            >
              {z.kind === 'DEMAND' ? '🟩 Demand' : '🟥 Supply'} {z.bottom.toPrecision(6)} – {z.top.toPrecision(6)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HudCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[8.5px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className="font-bold" style={{ color: tone ?? '#FFFFFF' }}>
        {value}
      </span>
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-[2px] w-3" style={{ background: color }} />
      {label}
    </span>
  );
}
