'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { CoinSnapshot, Timeframe } from '@/lib/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import { Icon } from '@/components/ui/Icons';

import { ChartHeadline, ChartStudio, useSymbolSetup, type ChartMode } from './ChartStudio';

/**
 * §1.1  Universal Click-to-Chart.
 *
 * Any coin tile, table row, signal card or monitoring coin anywhere in the
 * terminal calls `openChart()` and the Interactive Live Chart Studio slides in
 * over the current tab — no navigation, no lost scroll position, no waiting for
 * a route transition.
 *
 * Respects the account's saved `chartMode`: when the trader has chosen the
 * external TradingView widget, a coin click opens TradingView in a new tab
 * instead of hijacking the screen.
 */

interface ChartTarget {
  symbol: string;
  tf: Timeframe;
  /** Snapshot carried from the tile so the headline renders instantly. */
  coin?: CoinSnapshot;
}

interface ChartDrawerApi {
  openChart: (target: ChartTarget) => void;
  closeChart: () => void;
  isOpen: boolean;
}

const Ctx = createContext<ChartDrawerApi | null>(null);

export function useChartDrawer(): ChartDrawerApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useChartDrawer must be used inside <ChartDrawerProvider>');
  return api;
}

/**
 * Convenience wrapper for coin surfaces that hold a `CoinSnapshot` and the
 * current timeframe — the common case across all seven tabs.
 */
export function useOpenCoinChart(): (coin: CoinSnapshot, tf?: Timeframe) => void {
  const { openChart } = useChartDrawer();
  const { settings } = useSettings();

  return useCallback(
    (coin: CoinSnapshot, tf?: Timeframe) => {
      const timeframe = tf ?? settings.timeframe;
      if (settings.chartMode === 'EXTERNAL_TV') {
        const map: Record<Timeframe, string> = { '15M': '15', '30M': '30', '1H': '60', '4H': '240', '1D': 'D' };
        window.open(
          `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.baseAsset}USDT&interval=${map[timeframe]}`,
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      openChart({ symbol: coin.symbol, tf: timeframe, coin });
    },
    [openChart, settings.chartMode, settings.timeframe],
  );
}

/**
 * For surfaces that only know the symbol (Top Movers, monitoring tags, signal
 * cards) rather than holding a full `CoinSnapshot`.
 */
export function useOpenSymbolChart(): (symbol: string, tf?: Timeframe) => void {
  const { openChart } = useChartDrawer();
  const { settings } = useSettings();

  return useCallback(
    (symbol: string, tf?: Timeframe) => {
      const timeframe = tf ?? settings.timeframe;
      const base = symbol.replace(/USDT$/i, '');
      if (settings.chartMode === 'EXTERNAL_TV') {
        const map: Record<Timeframe, string> = { '15M': '15', '30M': '30', '1H': '60', '4H': '240', '1D': 'D' };
        window.open(
          `https://www.tradingview.com/chart/?symbol=BINANCE:${base}USDT&interval=${map[timeframe]}`,
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      openChart({ symbol: symbol.endsWith('USDT') ? symbol : `${symbol}USDT`, tf: timeframe });
    },
    [openChart, settings.chartMode, settings.timeframe],
  );
}

export function ChartDrawerProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ChartTarget | null>(null);
  const [mode, setMode] = useState<ChartMode>('INTERNAL');

  const openChart = useCallback((next: ChartTarget) => setTarget(next), []);
  const closeChart = useCallback(() => setTarget(null), []);

  /* Escape closes the drawer; the body stops scrolling behind it. */
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChart();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [target, closeChart]);

  const api = useMemo<ChartDrawerApi>(
    () => ({ openChart, closeChart, isOpen: target !== null }),
    [openChart, closeChart, target],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {target ? <DrawerBody target={target} mode={mode} setMode={setMode} onClose={closeChart} /> : null}
    </Ctx.Provider>
  );
}

function DrawerBody({
  target,
  mode,
  setMode,
  onClose,
}: {
  target: ChartTarget;
  mode: ChartMode;
  setMode: (m: ChartMode) => void;
  onClose: () => void;
}) {
  const { setup, scanner } = useSymbolSetup(target.symbol);
  const base = target.symbol.replace(/USDT$/i, '');

  return (
    <div className="fixed inset-0 z-[150] flex" role="dialog" aria-modal="true" aria-label={`${base} live chart`}>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close chart"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-black/70 backdrop-blur-sm"
      />

      {/* Full-height slide-over, right-aligned, full-width on small screens */}
      <div
        className="relative ml-auto flex h-full w-full flex-col overflow-hidden border-l border-white/[0.08] bg-bg-canvas shadow-2xl sm:w-[92vw] lg:w-[78vw] xl:w-[68vw]"
        style={{ boxShadow: '-24px 0 60px rgba(0,0,0,0.6)' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] bg-bg-topbar px-3 py-2">
          <ChartHeadline base={base} coin={target.coin} compact />
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`/chart/${base}?tf=${target.tf}`}
              className="btn-ghost whitespace-nowrap"
              title="Open as a full page"
            >
              <Icon name="external" size={12} />
              <span className="hidden sm:inline">Full Page</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded border border-white/10 bg-white/[0.03] p-1.5 text-text-muted transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <Icon name="chevronDown" size={14} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {scanner && setup ? (
            <p className="mb-2 text-[10px] text-text-muted">
              Levels from the live{' '}
              <span className="font-semibold text-amber-400">{scanner.replace(/-/g, ' ')}</span> setup on this pair.
            </p>
          ) : null}
          <ChartStudio
            symbol={target.symbol}
            tf={target.tf}
            mode={mode}
            onModeChange={setMode}
            height={420}
            setup={setup}
            compact
          />
        </div>
      </div>
    </div>
  );
}
