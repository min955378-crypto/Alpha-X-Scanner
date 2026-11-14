'use client';

import { useEffect, useMemo, useState } from 'react';

import { BRAND } from '@/lib/constants';
import { formatPct, formatPrice, formatRsi, formatRvol, tradingViewLink } from '@/lib/format';
import {
  TF_TO_TV,
  TIMEFRAMES,
  zoneForRsi,
  type CoinSnapshot,
  type ScannerSignal,
  type Timeframe,
} from '@/lib/types';
import { CopyButton, Pill, Segmented } from '@/components/ui';
import { Icon } from '@/components/ui/Icons';
import { useMarket } from '@/components/providers/MarketProvider';
import { useSettings } from '@/components/providers/SettingsProvider';

import { SniperChart, type ChartSetup } from './SniperChart';
import { TradingViewAdvanced } from './TradingViewAdvanced';
import { useLiveCandles } from './useLiveCandles';

/**
 * §1.2  The Interactive Live Chart Studio.
 *
 * One component, two hosts:
 *   • the dedicated route `/chart/:symbol`
 *   • the instant slide-over drawer on `/dashboard`
 *
 * Both get Mode A (Alpha X Native Sniper Chart with a live kline socket) and
 * Mode B (TradingView Advanced widget), the live timeframe pills that hot-swap
 * the stream without closing the chart, and the 1-click external links.
 */

export type ChartMode = 'INTERNAL' | 'EXTERNAL_TV';

export function ChartStudio({
  symbol,
  tf: tfProp,
  onTfChange,
  mode: modeProp,
  onModeChange,
  height = 460,
  /** Resolved scanner setup → ENTRY / SL / TP1 / TP2 price lines. */
  setup = null,
  compact = false,
}: {
  symbol: string;
  tf: Timeframe;
  onTfChange?: (tf: Timeframe) => void;
  mode?: ChartMode;
  onModeChange?: (mode: ChartMode) => void;
  height?: number;
  setup?: ChartSetup | null;
  /** Drawer layout: tighter paddings, no Pine script cards. */
  compact?: boolean;
}) {
  const { settings, update } = useSettings();

  const [tf, setTf] = useState<Timeframe>(tfProp);
  const [mode, setMode] = useState<ChartMode>(modeProp ?? (settings.chartMode === 'EXTERNAL_TV' ? 'EXTERNAL_TV' : 'INTERNAL'));

  /* The host may control tf/mode (route uses URL + settings); otherwise the
     studio owns them so the drawer stays self-contained. */
  useEffect(() => setTf(tfProp), [tfProp]);
  useEffect(() => {
    if (modeProp) setMode(modeProp);
  }, [modeProp]);

  const changeTf = (next: Timeframe) => {
    setTf(next);
    if (onTfChange) onTfChange(next);
    else void update('timeframe', next);
  };

  const changeMode = (next: ChartMode) => {
    setMode(next);
    if (onModeChange) onModeChange(next);
    else void update('chartMode', next);
  };

  const { candles, loading, error, live, source } = useLiveCandles(symbol, tf, mode === 'INTERNAL');
  const tvInterval = TF_TO_TV[tf];
  const base = symbol.replace(/USDT$/i, '');

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {/* ------------------------------- header ------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={tf} onChange={changeTf} options={TIMEFRAMES.map((t) => ({ value: t, label: t }))} />

        <div className="flex overflow-hidden rounded-lg border border-white/10">
          <ModeButton active={mode === 'INTERNAL'} onClick={() => changeMode('INTERNAL')} icon="candles" label="Alpha X Native" />
          <ModeButton active={mode === 'EXTERNAL_TV'} onClick={() => changeMode('EXTERNAL_TV')} icon="chart" label="TradingView" />
        </div>

        {live ? (
          <span className="mono-num flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            LIVE
          </span>
        ) : mode === 'INTERNAL' ? (
          <span className="mono-num rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-text-muted">
            HISTORY ONLY
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a href={tradingViewLink(base, tf)} target="_blank" rel="noopener noreferrer" className="btn-green whitespace-nowrap">
            Open External TradingView ↗
          </a>
          <a
            href={`https://www.binance.com/en/trade/${base}USDT?type=spot`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-amber whitespace-nowrap"
          >
            Binance Spot ↗
          </a>
        </div>
      </div>

      {/* ---------------------------- chart surface --------------------------- */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <h2 className="text-[13px] font-bold text-white">
            BINANCE:{base}USDT · {tf}{' '}
            <span className="mono-num text-[10px] text-text-muted">
              interval={tvInterval} · {mode === 'INTERNAL' ? 'Mode A · Native Sniper' : 'Mode B · TradingView'}
              {source ? ` · ${source}` : ''}
            </span>
          </h2>
          <CopyButton value={`BINANCE:${base}USDT`} label="symbol" />
        </div>

        <div className="bg-black/40">
          {mode === 'INTERNAL' ? (
            loading && !candles.length ? (
              <div className="grid place-items-center text-[11px] text-text-muted" style={{ height }}>
                Loading 500 candles for {symbol}…
              </div>
            ) : error && !candles.length ? (
              <div className="grid place-items-center px-6 text-center text-[11px] text-text-muted" style={{ height }}>
                <div>
                  <p>Candle history for {symbol} is not available yet ({error}).</p>
                  <button type="button" onClick={() => changeMode('EXTERNAL_TV')} className="btn-ghost mt-2">
                    Switch to TradingView ↗
                  </button>
                </div>
              </div>
            ) : (
              <SniperChart candles={candles} symbol={symbol} height={height} setup={setup} />
            )
          ) : (
            <TradingViewAdvanced symbol={symbol} interval={tvInterval} height={height + 160} />
          )}
        </div>

        <p className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-text-muted">
          {mode === 'INTERNAL'
            ? 'Rendered locally by Alpha X Scanner from live Binance klines. Candlestick colours are fixed: bullish emerald, bearish crimson.'
            : 'Charts are served by TradingView. '}
          {BRAND.productName} is an independent educational tool and is not affiliated with TradingView or Binance.
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric strip — shared by the full route                                     */
/* -------------------------------------------------------------------------- */

export function ChartMetrics({ coin }: { coin: CoinSnapshot | undefined }) {
  if (!coin) return null;
  const zone = zoneForRsi(coin.rsi);
  return (
    <section className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="RSI(14)" value={formatRsi(coin.rsi)} tone={zone?.accent} />
      <Metric label="RVOL(20)" value={formatRvol(coin.rvol)} tone={coin.rvol >= 1.5 ? '#F5B301' : undefined} />
      <Metric label="ATR(14) %" value={`${coin.atrPct.toFixed(2)}%`} />
      <Metric label="Alpha Sniper" value={coin.alphaSniper.toFixed(1)} tone="#A78BFA" />
      <Metric
        label="Win rate (500)"
        value={coin.wr500 === null ? 'WARMING UP' : `${coin.wr500.toFixed(1)}%`}
        tone={coin.wr500 === null ? '#7E8FA6' : coin.wr500 >= 55 ? '#22C55E' : '#F87171'}
      />
      <Metric label="24h volume" value={`$${(coin.quoteVol24h / 1e6).toFixed(1)}M`} />
    </section>
  );
}

export function ChartHeadline({
  base,
  coin,
  compact = false,
}: {
  base: string;
  coin: CoinSnapshot | undefined;
  compact?: boolean;
}) {
  const zone = coin ? zoneForRsi(coin.rsi) : null;
  return (
    <div className="flex items-center gap-3">
      <div>
        <h1 className={compact ? 'text-[16px] font-bold text-white' : 'text-[20px] font-bold text-white'}>
          {base}
          <span className="text-[13px] font-semibold text-text-muted">/USDT</span>
        </h1>
        <div className="mono-num mt-0.5 flex items-center gap-2 text-[11.5px]">
          <span className="select-all text-white">{coin ? formatPrice(coin.price) : '—'}</span>
          {coin ? (
            <span className={coin.changePct24h >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
              {formatPct(coin.changePct24h)}
            </span>
          ) : null}
          {coin && zone ? (
            <Pill tone="gray" className="border-white/20">
              RSI {formatRsi(coin.rsi)} · {zone.filterLabel}
            </Pill>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: 'candles' | 'chart';
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[10.5px] font-semibold transition-colors ${
        active ? 'bg-emerald-500/20 text-emerald-400' : 'text-text-secondary hover:bg-white/[0.05]'
      }`}
    >
      <Icon name={icon === 'chart' ? 'trending' : icon} size={13} />
      {label}
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-bg-card-2 px-2 py-1.5">
      <div className="text-[9.5px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mono-num text-[13px] font-bold" style={{ color: tone ?? '#FFFFFF' }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Resolves the highest-conviction live setup for a symbol across all five
 * scanners, so the chart can draw its ENTRY / SL / TP1 / TP2 levels.
 *
 * ENTRY_READY outranks WAITING, which outranks POTENTIAL — the trader wants to
 * see the actionable level, not a speculative one.
 */
export function useSymbolSetup(symbol: string): { setup: ChartSetup | null; scanner: string | null } {
  const { signals } = useMarket();

  return useMemo(() => {
    if (!symbol || !signals) return { setup: null, scanner: null };

    const rank: Record<string, number> = { ENTRY_READY: 0, WAITING: 1, POTENTIAL: 2, EXPIRED: 3, INVALIDATED: 4 };
    let best: ScannerSignal | null = null;

    for (const list of Object.values(signals)) {
      for (const sig of list ?? []) {
        if (sig.symbol !== symbol) continue;
        if (!best) {
          best = sig;
          continue;
        }
        const r = rank[sig.stage] ?? 9;
        const rb = rank[best.stage] ?? 9;
        if (r < rb || (r === rb && sig.score > best.score)) best = sig;
      }
    }

    if (!best) return { setup: null, scanner: null };
    return {
      setup: {
        direction: best.direction,
        entry: best.entryPrice,
        invalidation: best.invalidationPrice,
        tp1: best.tp1Price,
        tp2: best.tp2Price,
        scannerSlug: best.scannerSlug,
      },
      scanner: best.scannerSlug,
    };
  }, [symbol, signals]);
}
