'use client';

import { useMemo } from 'react';

import { formatPct, formatPrice, formatRsi, formatRvol, formatVolume } from '@/lib/format';
import { zoneForRsi, type CoinSnapshot, type MarketFrame, type Timeframe } from '@/lib/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useOpenCoinChart } from '@/components/chart/ChartDrawer';
import { CopyButton } from '@/components/ui';

/** §6.6  Watchlist (★) view — the same metrics as the Pro Table, filtered. */
export function WatchlistView({ frame, timeframe }: { frame: MarketFrame | null; timeframe: Timeframe }) {
  const { settings, toggleWatch } = useSettings();

  const rows = useMemo(() => {
    const set = new Set(settings.watchlist);
    return (frame?.coins ?? []).filter((c) => set.has(c.symbol)).sort((a, b) => b.quoteVol24h - a.quoteVol24h);
  }, [frame, settings.watchlist]);

  if (settings.watchlist.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-bg-card p-8 text-center">
        <div className="text-[15px] font-bold text-white">★ No watchlist coins yet</div>
        <p className="mx-auto mt-1.5 max-w-md text-[11.5px] leading-relaxed text-text-secondary">
          Tap the ★ on any row in the Pro Table or any coin in Coin Finder to pin it here. Your watchlist syncs to
          <code className="mono-num mx-1 text-amber-300">alpha-x-scanner:v2:watchlist</code>
          and to your user profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-bg-card p-2.5">
        <span className="text-[12px] font-bold text-white">
          ★ Watchlist · <span className="mono-num text-text-muted">{rows.length} coins</span>
        </span>
        <button
          type="button"
          onClick={() => {
            const txt = rows.map((c) => `BINANCE:${c.symbol}`).join(',');
            void navigator.clipboard?.writeText(txt);
          }}
          className="btn-ghost"
        >
          ⧉ Copy TradingView list
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-bg-card">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="bg-bg-card-2 text-[10.5px] font-bold text-text-secondary">
            <tr>
              <th className="px-2 py-1.5 text-left">Coin</th>
              <th className="px-2 py-1.5 text-right">Price</th>
              <th className="px-2 py-1.5 text-right">24h %</th>
              <th className="px-2 py-1.5 text-right">RSI</th>
              <th className="px-2 py-1.5 text-right">RVOL</th>
              <th className="px-2 py-1.5 text-right">Volume</th>
              <th className="px-2 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <WatchRow key={c.symbol} coin={c} timeframe={timeframe} onUnwatch={() => toggleWatch(c.symbol)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WatchRow({
  coin,
  timeframe,
  onUnwatch,
}: {
  coin: CoinSnapshot;
  timeframe: Timeframe;
  onUnwatch: () => void;
}) {
  const openCoin = useOpenCoinChart();
  const zone = zoneForRsi(coin.rsi);
  return (
    <tr className="border-b border-white/[0.03] hover:bg-bg-hover">
      <td className="px-2 py-1.5">
        <span className="select-all font-bold text-white">{coin.baseAsset}</span>
        {coin.isMonitoringTag ? <span className="ml-1 text-amber-400">⚠</span> : null}
      </td>
      <td className="mono-num px-2 py-1.5 text-right">{formatPrice(coin.price)}</td>
      <td className={`mono-num px-2 py-1.5 text-right font-semibold ${coin.changePct24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {formatPct(coin.changePct24h)}
      </td>
      <td className="mono-num px-2 py-1.5 text-right">
        <span style={{ color: zone.accent }}>{formatRsi(coin.rsi)}</span>
      </td>
      <td className="mono-num px-2 py-1.5 text-right text-amber-400">{formatRvol(coin.rvol)}</td>
      <td className="mono-num px-2 py-1.5 text-right text-text-secondary">{formatVolume(coin.quoteVol24h)}</td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <a
            href={`/chart/${coin.baseAsset}?tf=${timeframe}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              openCoin(coin, timeframe);
            }}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:text-white"
          >
            Chart
          </a>
          <CopyButton value={coin.symbol} label="symbol" compact />
          <button
            type="button"
            onClick={onUnwatch}
            className="rounded border border-white/10 px-1 text-[9.5px] text-amber-400 hover:text-red-400"
            aria-label={`Remove ${coin.baseAsset} from watchlist`}
          >
            ★
          </button>
        </div>
      </td>
    </tr>
  );
}
