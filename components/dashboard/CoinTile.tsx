'use client';

import { memo } from 'react';

import { formatPct, formatRsi } from '@/lib/format';
import { useTickFlash } from '@/components/ui/Motion3D';
import { DENSITY } from '@/lib/constants';
import type { CoinSnapshot, Timeframe, ZoneDef } from '@/lib/types';

/**
 * §6.3  Coin tile anatomy:
 *   line 1 — base symbol + ⚠ when the coin carries a Binance Monitoring Tag
 *   line 2 — RSI: 80.9  +  signed 24h change
 *
 * Monitoring-Tag coins override their zone palette with the olive/khaki-gold
 * treatment so risk is visible before anything else.
 */
export const CoinTile = memo(function CoinTile({
  coin,
  zone,
  timeframe,
  density,
  onOpen,
  highlighted = false,
}: {
  coin: CoinSnapshot;
  zone: ZoneDef;
  timeframe: Timeframe;
  density: 'COMPACT' | 'COMFORTABLE';
  onOpen: (coin: CoinSnapshot, timeframe: Timeframe) => void;
  highlighted?: boolean;
}) {
  const d = DENSITY[density];
  const warn = coin.isMonitoringTag;

  const style = warn
    ? { background: 'var(--tile-warn-bg)', borderColor: 'var(--tile-warn-border)' }
    : { background: zone.cssBg, borderColor: zone.cssBorder };

  const positive = coin.changePct24h >= 0;
  // §Phase 2 §2.4 — 600ms radial pulse whenever the live price ticks.
  const pulse = useTickFlash(coin.price);

  return (
    <a
      href={`https://www.tradingview.com/chart/?symbol=BINANCE:${coin.baseAsset}USDT&interval=${TF_TOKEN[timeframe]}`}
      data-tile={coin.symbol}
      onClick={(e) => {
        // Let modified clicks open a real tab; otherwise honour the user's
        // §11.2 "Coin Tile Click Behavior" preference.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(coin, timeframe);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      aria-label={`${coin.baseAsset}${warn ? ', Warning: Binance Monitoring Tag' : ''}, ${zone.title}, RSI ${formatRsi(
        coin.rsi,
      )}, 24h change ${formatPct(coin.changePct24h)}`}
      title={`${coin.baseAsset} · RSI ${formatRsi(coin.rsi)}${warn ? ' · ⚠ Monitoring Tag' : ''}`}
      style={{ width: d.tileW, height: d.tileH, ...style }}
      className={`zone-tile shrink-0 rounded-md hover:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-amber-400 ${
        highlighted ? 'ring-2 ring-amber-400' : ''
      } ${pulse}`}
    >
      <span
        style={{ fontSize: d.symbol }}
        className={`font-bold leading-none ${warn ? 'text-[var(--tile-warn-text)]' : 'text-white'}`}
      >
        {coin.baseAsset}
        {warn ? <span aria-hidden="true"> ⚠</span> : null}
      </span>
      <span style={{ fontSize: d.sub }} className="mono-num leading-none text-gray-200">
        RSI: {formatRsi(coin.rsi)}{' '}
        <span className={`font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {formatPct(coin.changePct24h, 1)}
        </span>
      </span>
    </a>
  );
});

const TF_TOKEN: Record<Timeframe, string> = { '15M': '15', '30M': '30', '1H': '60', '4H': '240', '1D': 'D' };

/**
 * §13  Arrow-key roving focus across the heatmap grid with a visible
 * 2px solid #F5B301 focus ring.
 */
export function heatmapKeyNav(e: React.KeyboardEvent, container: HTMLElement | null): boolean {
  if (!container) return false;
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
  if (!keys.includes(e.key)) return false;

  const tiles = Array.from(container.querySelectorAll<HTMLElement>('[data-tile]'));
  if (tiles.length === 0) return false;

  const active = document.activeElement as HTMLElement | null;
  const currentIndex = active && active.dataset.tile ? tiles.indexOf(active) : -1;
  if (currentIndex === -1) {
    tiles[0].focus();
    e.preventDefault();
    return true;
  }

  // Derive the column count from the rendered rows.
  const firstTop = tiles[0].getBoundingClientRect().top;
  let columns = 0;
  for (const t of tiles) {
    if (Math.abs(t.getBoundingClientRect().top - firstTop) > 2) break;
    columns += 1;
  }
  columns = Math.max(1, columns);

  const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : -columns;
  const next = Math.max(0, Math.min(tiles.length - 1, currentIndex + delta));
  tiles[next].focus();
  e.preventDefault();
  return true;
}
