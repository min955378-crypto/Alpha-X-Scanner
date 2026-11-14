'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatFunding, formatPct, formatPrice, formatRsi, formatRvol, formatVolume, levelCopyValue, tradingViewLink } from '@/lib/format';
import { formatFullVolume } from '@/lib/format';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useMarket } from '@/components/providers/MarketProvider';
import { CopyButton, Pill } from '@/components/ui';
import { zoneForRsi } from '@/lib/types';
import type { CoinSnapshot, MarketFrame, ObStatus, EmaStatus, Timeframe } from '@/lib/types';

const ROW_H = 26;
const OVERSCAN = 8;
const VIEWPORT_H = 600;

type SortKey = 'rank' | 'symbol' | 'price' | 'changePct24h' | 'rsi' | 'quoteVol24h' | 'rvol' | 'spreadPct' | 'fundingRatePct' | 'score' | 'obStatus' | 'emaStatus';

/** §6.4  Complete 14-column specification. */
const COLUMNS: Array<{ key: string; label: string; width: number; align: 'left' | 'right' | 'center'; sort?: SortKey }> = [
  { key: 'star', label: '★', width: 32, align: 'center' },
  { key: 'rank', label: '#', width: 40, align: 'right' },
  { key: 'symbol', label: 'Coin', width: 155, align: 'left', sort: 'symbol' },
  { key: 'price', label: 'Price', width: 110, align: 'right', sort: 'price' },
  { key: 'change', label: '24h %', width: 95, align: 'right', sort: 'changePct24h' },
  { key: 'rsi', label: 'RSI (TF)', width: 95, align: 'right', sort: 'rsi' },
  { key: 'volume', label: '24h Volume', width: 115, align: 'right', sort: 'quoteVol24h' },
  { key: 'rvol', label: 'RVOL', width: 85, align: 'right', sort: 'rvol' },
  { key: 'score', label: 'Score', width: 88, align: 'right', sort: 'score' },
  { key: 'range', label: 'Range 24h', width: 145, align: 'center' },
  { key: 'spread', label: 'Spread', width: 80, align: 'right', sort: 'spreadPct' },
  { key: 'funding', label: 'Funding', width: 85, align: 'right', sort: 'fundingRatePct' },
  { key: 'ob', label: 'Order Block', width: 125, align: 'left', sort: 'obStatus' },
  { key: 'ema', label: 'EMA / Sniper', width: 125, align: 'left', sort: 'emaStatus' },
  { key: 'actions', label: 'Actions', width: 120, align: 'right' },
];

const TOTAL_W = COLUMNS.reduce((s, c) => s + c.width, 0);

type QuickFilter = 'ALL' | 'LONG' | 'SHORT' | 'V1' | 'HIDDEN_BULL' | 'VOL_20M' | 'RVOL_15' | 'NO_MONITORING' | 'WATCHLIST';

const QUICK_FILTERS: Array<{ id: QuickFilter; label: string }> = [
  { id: 'ALL', label: 'All coins' },
  { id: 'LONG', label: 'Long Setups' },
  { id: 'SHORT', label: 'Short Setups' },
  { id: 'V1', label: 'RSI 50-60 V1' },
  { id: 'HIDDEN_BULL', label: 'RSI 30-40 Hidden Bull' },
  { id: 'VOL_20M', label: 'Volume > $20M' },
  { id: 'RVOL_15', label: 'RVOL ≥ 1.5×' },
  { id: 'NO_MONITORING', label: 'Hide ⚠ Monitoring Tags' },
  { id: 'WATCHLIST', label: 'Watchlist ★' },
];

export function ProTableView({ frame, timeframe }: { frame: MarketFrame | null; timeframe: Timeframe }) {
  const { settings, toggleWatch, isWatched } = useSettings();
  const { livePrices, tickVersion } = useMarket();

  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('quoteVol24h');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [scrollTop, setScrollTop] = useState(0);

  const rows = useMemo(() => {
    let list = frame?.coins ?? [];
    const q = query.trim().toUpperCase();
    if (q) list = list.filter((c) => c.symbol.includes(q) || c.baseAsset.includes(q));

    switch (quick) {
      case 'LONG':
        list = list.filter((c) => c.ema9 > c.ema21 && c.rsi >= 50);
        break;
      case 'SHORT':
        list = list.filter((c) => c.ema9 < c.ema21 && c.rsi < 50);
        break;
      case 'V1':
        list = list.filter((c) => c.rsi >= 50 && c.rsi < 60);
        break;
      case 'HIDDEN_BULL':
        list = list.filter((c) => c.rsi >= 30 && c.rsi < 40);
        break;
      case 'VOL_20M':
        list = list.filter((c) => c.quoteVol24h >= 20_000_000);
        break;
      case 'RVOL_15':
        list = list.filter((c) => c.rvol >= 1.5);
        break;
      case 'NO_MONITORING':
        list = list.filter((c) => !c.isMonitoringTag);
        break;
      case 'WATCHLIST':
        list = list.filter((c) => isWatched(c.symbol));
        break;
      default:
        break;
    }

    const sorted = [...list].sort((a, b) => {
      let d = 0;
      switch (sortKey) {
        case 'symbol':
          d = a.baseAsset.localeCompare(b.baseAsset);
          break;
        case 'rank':
          d = a.quoteVol24h - b.quoteVol24h;
          break;
        case 'obStatus':
          d = a.obStatus.localeCompare(b.obStatus);
          break;
        case 'emaStatus':
          d = a.emaStatus.localeCompare(b.emaStatus);
          break;
        case 'fundingRatePct':
          d = (a.fundingRatePct ?? -999) - (b.fundingRatePct ?? -999);
          break;
        case 'score':
          d = a.score - b.score;
          break;
        default:
          d = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === 'desc' ? -d : d;
    });
    return sorted;
  }, [frame, query, quick, sortKey, sortDir, isWatched]);

  const exportCsv = useCallback(() => {
    const header = COLUMNS.map((c) => c.label).join(',');
    const body = rows
      .map((c) =>
        [
          '',
          '',
          c.baseAsset,
          levelCopyValue(c.price),
          c.changePct24h.toFixed(2),
          c.rsi.toFixed(1),
          Math.round(c.quoteVol24h),
          c.rvol.toFixed(2),
          '',
          c.spreadPct.toFixed(3),
          c.fundingRatePct?.toFixed(4) ?? '',
          c.obStatus,
          c.emaStatus,
        ].join(','),
      )
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scalppro-pro-table-${timeframe}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, timeframe]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  const toggleSort = (key?: SortKey) => {
    if (!key) return;
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-bg-card p-2.5">
        <input
          data-search-input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search coin or paste BINANCE:BTCUSDT"
          className="input mono-num w-[260px] flex-1"
          aria-label="Search coins"
        />
        <div className="flex flex-wrap gap-1">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={quick === f.id}
              onClick={() => setQuick(f.id)}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                quick === f.id
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-white/10 bg-white/[0.03] text-text-secondary hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={exportCsv} className="btn-ghost whitespace-nowrap">
          ⭳ Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-bg-card">
        <div className="overflow-x-auto">
          <div style={{ minWidth: TOTAL_W }}>
            <div
              role="row"
              className="flex h-[30px] items-center border-b border-white/10 bg-bg-card-2 text-[10.5px] font-bold text-text-secondary"
            >
              {COLUMNS.map((c) => (
                <div
                  key={c.key}
                  role="columnheader"
                  aria-sort={sortKey === c.sort ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                  style={{ width: c.width }}
                  className={`shrink-0 px-2 ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}
                >
                  {c.sort ? (
                    <button type="button" onClick={() => toggleSort(c.sort)} className="hover:text-white">
                      {c.label}
                      {sortKey === c.sort ? <span aria-hidden="true">{sortDir === 'desc' ? ' ▾' : ' ▴'}</span> : null}
                    </button>
                  ) : (
                    c.label
                  )}
                </div>
              ))}
            </div>

            <div
              style={{ height: VIEWPORT_H }}
              onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
              className="overflow-y-auto"
              role="rowgroup"
            >
              <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
                {visible.map((coin, i) => {
                  const rank = start + i + 1;
                  return (
                    <ProTableRow
                      key={coin.symbol}
                      coin={coin}
                      rank={rank}
                      top={(start + i) * ROW_H}
                      timeframe={timeframe}
                      watched={isWatched(coin.symbol)}
                      onWatch={() => toggleWatch(coin.symbol)}
                      livePrice={livePrices?.current.get(coin.symbol)?.[0]}
                      volumeFormat={settings.volumeFormat}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mono-num flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5 text-[10.5px] text-text-muted">
          <span>
            {rows.length} coins · virtualized ({visible.length} rendered) · sort: {sortKey} {sortDir}
          </span>
          <span>Row height {ROW_H}px · press “/” to search</span>
        </div>
      </div>
      <span className="hidden">{tickVersion}</span>
    </div>
  );
}

function ProTableRow({
  coin,
  rank,
  top,
  timeframe,
  watched,
  onWatch,
  livePrice,
  volumeFormat,
}: {
  coin: CoinSnapshot;
  rank: number;
  top: number;
  timeframe: Timeframe;
  watched: boolean;
  onWatch: () => void;
  livePrice: number | undefined;
  volumeFormat: 'ABBREVIATED' | 'FULL';
}) {
  const price = livePrice ?? coin.price;
  const flash = usePriceFlash(price);

  const zone = zoneForRsi(coin.rsi);
  const rangePct = coin.high24h > coin.low24h ? ((price - coin.low24h) / (coin.high24h - coin.low24h)) * 100 : 50;

  return (
    <div
      role="row"
      style={{ top, height: ROW_H }}
      className={`absolute left-0 right-0 flex items-center border-b border-white/[0.03] text-[11.5px] hover:bg-bg-hover ${
        watched ? 'bg-amber-500/[0.04]' : ''
      }`}
    >
      {/* 1 ★ */}
      <div className="shrink-0 px-2 text-center" style={{ width: 32 }}>
        <button
          type="button"
          onClick={onWatch}
          aria-label={`${watched ? 'Remove' : 'Add'} ${coin.baseAsset} ${watched ? 'from' : 'to'} watchlist`}
          aria-pressed={watched}
          className={`text-[12px] ${watched ? 'text-amber-400' : 'text-text-muted hover:text-amber-300'}`}
        >
          {watched ? '★' : '☆'}
        </button>
      </div>

      {/* 2 # */}
      <div className="mono-num shrink-0 px-2 text-right text-text-muted" style={{ width: 40 }}>
        {rank}
      </div>

      {/* 3 Coin */}
      <div className="flex shrink-0 items-center gap-1.5 px-2" style={{ width: 155 }}>
        <CoinMonogram symbol={coin.baseAsset} />
        <span className="select-all font-bold text-white">{coin.baseAsset}</span>
        <span className="text-[10px] text-text-muted">/USDT</span>
        {coin.isMonitoringTag ? (
          <Pill tone="amber" className="px-1 py-0" title="Binance Monitoring Tag">
            ⚠
          </Pill>
        ) : null}
      </div>

      {/* 4 Price */}
      <div className={`mono-num shrink-0 px-2 text-right ${flash}`} style={{ width: 110 }}>
        <span className="select-all">{formatPrice(price)}</span>
      </div>

      {/* 5 24h % */}
      <div className="mono-num shrink-0 px-2 text-right" style={{ width: 95 }}>
        <span className={coin.changePct24h >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
          {coin.changePct24h >= 0 ? '▲' : '▼'} {formatPct(coin.changePct24h)}
        </span>
      </div>

      {/* 6 RSI */}
      <div className="mono-num shrink-0 px-2 text-right" style={{ width: 95 }}>
        <span
          className="rounded px-1 py-0.5 text-[10.5px] font-bold"
          style={{ color: zone.accent, background: `${zone.accent}1f` }}
        >
          {formatRsi(coin.rsi)} · {zoneShort(zone.id)}
        </span>
      </div>

      {/* 7 24h Volume */}
      <div className="mono-num shrink-0 px-2 text-right text-text-secondary" style={{ width: 115 }}>
        {volumeFormat === 'FULL' ? formatFullVolume(coin.quoteVol24h) : formatVolume(coin.quoteVol24h)}
      </div>

      {/* 8 RVOL */}
      <div className="mono-num shrink-0 px-2 text-right" style={{ width: 85 }}>
        <span className={coin.rvol >= 1.5 ? 'font-bold text-amber-400' : 'text-text-secondary'}>
          {coin.rvol >= 1.5 ? <span aria-hidden="true">🔥 </span> : null}
          {formatRvol(coin.rvol)}
        </span>
      </div>

      {/* 8b §7.3 Score — the same 0–100 number the scanner card shows. */}
      <div className="shrink-0 px-2 text-right" style={{ width: 88 }}>
        <ScoreCell score={coin.score} />
      </div>

      {/* 9 Range 24h */}
      <div className="shrink-0 px-2" style={{ width: 145 }}>
        <div className="flex items-center gap-1">
          <span className="mono-num text-[9px] text-text-muted">{formatPrice(coin.low24h)}</span>
          <div className="relative h-[6px] flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-500/60 to-emerald-500/60" style={{ width: `${Math.max(2, Math.min(100, rangePct))}%` }} />
          </div>
          <span className="mono-num text-[9px] text-text-muted">{formatPrice(coin.high24h)}</span>
        </div>
      </div>

      {/* 10 Spread */}
      <div className="mono-num shrink-0 px-2 text-right" style={{ width: 80 }}>
        <span className={coin.spreadPct > 0.1 ? 'font-semibold text-amber-400' : 'text-text-secondary'}>
          {coin.spreadPct.toFixed(3)}%
        </span>
      </div>

      {/* 11 Funding */}
      <div className="mono-num shrink-0 px-2 text-right" style={{ width: 85 }}>
        <span
          className={
            coin.fundingRatePct === null
              ? 'text-text-muted'
              : coin.fundingRatePct > 0
                ? 'text-emerald-400'
                : 'text-red-400'
          }
        >
          {formatFunding(coin.fundingRatePct)}
        </span>
      </div>

      {/* 12 Order Block */}
      <div className="shrink-0 px-2" style={{ width: 125 }}>
        <ObBadge status={coin.obStatus} />
      </div>

      {/* 13 EMA / Sniper */}
      <div className="shrink-0 px-2" style={{ width: 125 }}>
        <EmaBadge status={coin.emaStatus} />
      </div>

      {/* 14 Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 px-2" style={{ width: 120 }}>
        <a
          href={tradingViewLink(coin.baseAsset, timeframe)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:text-white"
        >
          Chart ↗
        </a>
        <a
          href={`/scanners/v1-scaling?symbol=${coin.baseAsset}`}
          className="rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:text-white"
        >
          Scan
        </a>
        <span className="inline-flex gap-0.5">
          <CopyButton value={coin.symbol} label="symbol" compact />
          <CopyButton value={levelCopyValue(coin.price)} label="price" compact />
        </span>
      </div>
    </div>
  );
}

/**
 * §6.4 col 4 — flash the price cell green/red for 600ms on every tick.
 * Driven by an effect (not render) so React 18 StrictMode stays honest.
 */
function usePriceFlash(price: number): string {
  const lastRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = lastRef.current;
    lastRef.current = price;
    if (prev === null || prev === price) return;
    setFlash(price > prev ? 'up' : 'down');
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  return flash === 'up' ? 'animate-flash-up' : flash === 'down' ? 'animate-flash-down' : '';
}

/**
 * §7.3  Score cell. 0 means "no active setup on this timeframe" — rendered as
 * an em dash rather than a misleading zero.
 */
function ScoreCell({ score }: { score: number }) {
  if (score <= 0) return <span className="mono-num text-[10.5px] text-text-muted">—</span>;
  const tone = score >= 75 ? 'text-emerald-400' : score >= 55 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center justify-end gap-1" title={`Score ${score}/100 (§7.3)`}>
      <div className="h-[4px] w-[28px] overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full ${score >= 75 ? 'bg-emerald-500' : score >= 55 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`mono-num text-[10.5px] font-bold ${tone}`}>{score}</span>
    </div>
  );
}

function zoneShort(id: string): string {
  return { GAINERS: 'Gain', V1: 'V1', NEUTRAL: 'Neut', HIDDEN_BULL: 'HB', OVERSOLD: 'OS', EXTREME: 'Ext' }[id] ?? '';
}

function ObBadge({ status }: { status: ObStatus }) {
  if (status === 'DEMAND_BUY') return <Pill tone="green">DEMAND · BUY</Pill>;
  if (status === 'SUPPLY_WAIT') return <Pill tone="red">SUPPLY · WAIT</Pill>;
  return <span className="text-text-muted">—</span>;
}

function EmaBadge({ status }: { status: EmaStatus }) {
  switch (status) {
    case 'GOLDEN_9_21':
      return <Pill tone="green">GOLDEN 9&gt;21</Pill>;
    case 'DEATH_9_21':
      return <Pill tone="red">DEATH 9&lt;21</Pill>;
    case 'SNIPER_BUY':
      return <Pill tone="purple">SNIPER BUY</Pill>;
    case 'SNIPER_SELL':
      return <Pill tone="orange">SNIPER SELL</Pill>;
    default:
      return <span className="text-text-muted">—</span>;
  }
}

/** Deterministic monogram tile so every coin has a stable visual anchor. */
function CoinMonogram({ symbol }: { symbol: string }) {
  let h = 0;
  for (let i = 0; i < symbol.length; i += 1) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    <span
      aria-hidden="true"
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-black"
      style={{ background: `hsl(${hue} 62% 58%)` }}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}
