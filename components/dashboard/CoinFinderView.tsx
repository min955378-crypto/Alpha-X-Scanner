'use client';

import { Fragment, useCallback, useMemo, useState } from 'react';

import { computeScore } from '@/lib/score';
import { formatPct, formatPrice, formatRsi, formatRvol, formatVolume, tradingViewLink } from '@/lib/format';
import { ZONES, zoneForRsi, type CoinSnapshot, type MarketFrame, type Timeframe, type ZoneId } from '@/lib/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import { CopyButton, Pill } from '@/components/ui';

/**
 * §6.5  Mode C — Boolean Coin Finder.
 * Left: repeatable filter builder. Right: live-scored results with an
 * expandable "Why it matched" summary.
 */

type FieldKey =
  | 'rsi'
  | 'rsiDelta'
  | 'alphaSniper'
  | 'ema9v21'
  | 'ema21v50'
  | 'priceVsEma21'
  | 'atrPct'
  | 'rvol';
type Operator = '>' | '<' | '≥' | '≤' | 'between';

const FIELDS: Array<{ key: FieldKey; label: string; unit?: string }> = [
  { key: 'rsi', label: 'RSI(14)' },
  { key: 'rsiDelta', label: 'RSI Delta (60s)' },
  { key: 'alphaSniper', label: 'Alpha Sniper EMA(RSI,3)' },
  { key: 'ema9v21', label: 'EMA9 vs EMA21', unit: '%' },
  { key: 'ema21v50', label: 'EMA21 vs EMA50', unit: '%' },
  { key: 'priceVsEma21', label: 'Price vs EMA21 Dist %', unit: '%' },
  { key: 'atrPct', label: 'ATR(14) %', unit: '%' },
  { key: 'rvol', label: 'RVOL(20)', unit: '×' },
];

const OPERATORS: Operator[] = ['>', '<', '≥', '≤', 'between'];

const VOLUME_PRESETS: Array<{ label: string; value: number }> = [
  { label: 'Any', value: 0 },
  { label: '≥ $5M', value: 5_000_000 },
  { label: '≥ $20M', value: 20_000_000 },
  { label: '≥ $50M', value: 50_000_000 },
  { label: '≥ $100M', value: 100_000_000 },
  { label: '≥ $500M', value: 500_000_000 },
];

interface Condition {
  id: number;
  field: FieldKey;
  op: Operator;
  value: number;
  value2: number;
}

export function CoinFinderView({ frame, timeframe }: { frame: MarketFrame | null; timeframe: Timeframe }) {
  const { settings, savePreset, deletePreset } = useSettings();

  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minChange, setMinChange] = useState(-30);
  const [maxChange, setMaxChange] = useState(50);
  const [volFloor, setVolFloor] = useState(5_000_000);
  const [minRvol, setMinRvol] = useState(1.5);
  const [zones, setZones] = useState<Set<ZoneId>>(new Set(ZONES.map((z) => z.id)));
  const [maxSpread, setMaxSpread] = useState(0.05);
  const [excludeMonitoring, setExcludeMonitoring] = useState(true);
  const [conditions, setConditions] = useState<Condition[]>([
    { id: 1, field: 'rvol', op: '≥', value: 1.5, value2: 3 },
  ]);
  const [matchMode, setMatchMode] = useState<'AND' | 'OR'>('AND');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');

  const addCondition = () =>
    setConditions((prev) => [...prev, { id: Date.now(), field: 'rsi', op: '>', value: 50, value2: 60 }]);

  const removeCondition = (id: number) => setConditions((prev) => prev.filter((c) => c.id !== id));

  const results = useMemo(() => {
    const coins = frame?.coins ?? [];
    const min = minPrice === '' ? -Infinity : Number(minPrice);
    const max = maxPrice === '' ? Infinity : Number(maxPrice);

    return coins
      .filter((c) => {
        if (c.price < min || c.price > max) return false;
        if (c.changePct24h < minChange || c.changePct24h > maxChange) return false;
        if (c.quoteVol24h < volFloor) return false;
        if (c.rvol < minRvol) return false;
        if (!zones.has(zoneForRsi(c.rsi).id)) return false;
        if (c.spreadPct > maxSpread) return false;
        if (excludeMonitoring && c.isMonitoringTag) return false;

        if (conditions.length === 0) return true;
        const checks = conditions.map((cond) => evaluate(c, cond));
        return matchMode === 'AND' ? checks.every(Boolean) : checks.some(Boolean);
      })
      .map((c) => ({ coin: c, score: matchScore(c), reasons: whyMatched(c, conditions) }))
      .sort((a, b) => b.score - a.score);
  }, [frame, minPrice, maxPrice, minChange, maxChange, volFloor, minRvol, zones, maxSpread, excludeMonitoring, conditions, matchMode]);

  const copyWatchlist = useCallback(() => {
    const txt = results.map((r) => `BINANCE:${r.coin.symbol}`).join(',');
    void navigator.clipboard?.writeText(txt);
  }, [results]);

  const exportCsv = useCallback(() => {
    const header = 'Symbol,Price,24h%,RSI,RVOL,Volume24h,Spread%,MatchScore';
    const body = results
      .map(
        (r) =>
          `${r.coin.symbol},${r.coin.price},${r.coin.changePct24h.toFixed(2)},${r.coin.rsi.toFixed(1)},${r.coin.rvol.toFixed(
            2,
          )},${Math.round(r.coin.quoteVol24h)},${r.coin.spreadPct.toFixed(3)},${r.score}`,
      )
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alpha-x-scanner-coin-finder-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  return (
    <div className="grid gap-3 xl:grid-cols-[340px_1fr]">
      {/* ------------------------- LEFT: builder ------------------------- */}
      <section className="card space-y-3 p-3" aria-label="Filter builder">
        <h2 className="text-[13px] font-bold text-white">🔍 Coin Finder</h2>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-text-secondary">Min USDT</span>
            <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} inputMode="decimal" className="input mono-num" placeholder="0" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-text-secondary">Max USDT</span>
            <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} inputMode="decimal" className="input mono-num" placeholder="∞" />
          </label>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[10.5px] text-text-secondary">
            <span>24h % change range</span>
            <span className="mono-num text-white">
              {minChange}% … {maxChange}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={-30}
              max={50}
              value={minChange}
              onChange={(e) => setMinChange(Math.min(Number(e.target.value), maxChange))}
              className="h-1 flex-1 accent-amber-500"
              aria-label="Minimum 24h change"
            />
            <input
              type="range"
              min={-30}
              max={50}
              value={maxChange}
              onChange={(e) => setMaxChange(Math.max(Number(e.target.value), minChange))}
              className="h-1 flex-1 accent-emerald-500"
              aria-label="Maximum 24h change"
            />
          </div>
        </div>

        <div>
          <span className="mb-1 block text-[10.5px] text-text-secondary">24h quote volume floor</span>
          <div className="flex flex-wrap gap-1">
            {VOLUME_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={volFloor === p.value}
                onClick={() => setVolFloor(p.value)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  volFloor === p.value
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-white/10 bg-white/[0.03] text-text-secondary hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[10.5px] text-text-secondary">
            <span>Relative volume RVOL(20)</span>
            <span className="mono-num text-white">≥ {minRvol.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            step={0.1}
            value={minRvol}
            onChange={(e) => setMinRvol(Number(e.target.value))}
            className="h-1 w-full accent-amber-500"
            aria-label="Minimum RVOL"
          />
        </div>

        <div>
          <span className="mb-1 block text-[10.5px] text-text-secondary">RSI zones</span>
          <div className="space-y-1">
            {ZONES.map((z) => (
              <label key={z.id} className="flex cursor-pointer items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={zones.has(z.id)}
                  onChange={() =>
                    setZones((prev) => {
                      const next = new Set(prev);
                      if (next.has(z.id)) next.delete(z.id);
                      else next.add(z.id);
                      return next;
                    })
                  }
                  className="h-3 w-3 accent-amber-500"
                />
                <span style={{ color: z.accent }} aria-hidden="true">
                  {z.emoji}
                </span>
                <span className="text-text-secondary">{z.filterLabel}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[10.5px] text-text-secondary">
            <span>Max bid-ask spread</span>
            <span className="mono-num text-white">≤ {maxSpread.toFixed(3)}%</span>
          </div>
          <input
            type="range"
            min={0.01}
            max={0.5}
            step={0.005}
            value={maxSpread}
            onChange={(e) => setMaxSpread(Number(e.target.value))}
            className="h-1 w-full accent-emerald-500"
            aria-label="Maximum bid-ask spread"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px]">
          <input
            type="checkbox"
            checked={excludeMonitoring}
            onChange={(e) => setExcludeMonitoring(e.target.checked)}
            className="h-3 w-3 accent-amber-500"
          />
          <span className="text-text-bright">Exclude ⚠ Monitoring Tag Coins</span>
        </label>

        {/* Repeatable indicator conditions */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] text-text-secondary">Indicator conditions</span>
            <div className="flex gap-1">
              <button type="button" onClick={addCondition} className="btn-ghost px-1.5 py-0.5 text-[10px]">
                + Add
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {conditions.map((c) => (
              <div key={c.id} className="flex items-center gap-1">
                <select
                  value={c.field}
                  onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, field: e.target.value as FieldKey } : x)))}
                  className="input h-7 flex-1 text-[10.5px]"
                  aria-label="Condition field"
                >
                  {FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  value={c.op}
                  onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, op: e.target.value as Operator } : x)))}
                  className="input h-7 w-[58px] text-[10.5px]"
                  aria-label="Condition operator"
                >
                  {OPERATORS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input
                  value={c.value}
                  onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, value: Number(e.target.value) } : x)))}
                  className="input mono-num h-7 w-[54px] text-[10.5px]"
                  inputMode="decimal"
                  aria-label="Condition value"
                />
                {c.op === 'between' ? (
                  <input
                    value={c.value2}
                    onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, value2: Number(e.target.value) } : x)))}
                    className="input mono-num h-7 w-[54px] text-[10.5px]"
                    inputMode="decimal"
                    aria-label="Condition upper value"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => removeCondition(c.id)}
                  className="rounded border border-white/10 px-1 text-[10px] text-text-muted hover:text-red-400"
                  aria-label="Remove condition"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 flex gap-1">
            {(['AND', 'OR'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={matchMode === m}
                onClick={() => setMatchMode(m)}
                className={`flex-1 rounded border px-2 py-1 text-[10.5px] font-semibold ${
                  matchMode === m
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-white/10 bg-white/[0.03] text-text-secondary hover:text-white'
                }`}
              >
                {m === 'AND' ? 'All Conditions (AND)' : 'Any Condition (OR)'}
              </button>
            ))}
          </div>
        </div>

        {/* Preset manager */}
        <div className="space-y-1.5 border-t border-white/[0.06] pt-2">
          <div className="flex gap-1">
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="input h-7 flex-1 text-[10.5px]"
              aria-label="Preset name"
            />
            <button
              type="button"
              onClick={() => {
                if (!presetName.trim()) return;
                savePreset(presetName.trim(), {
                  minPrice,
                  maxPrice,
                  minChange,
                  maxChange,
                  volFloor,
                  minRvol,
                  zones: [...zones],
                  maxSpread,
                  excludeMonitoring,
                  conditions,
                  matchMode,
                });
                setPresetName('');
              }}
              className="btn-green whitespace-nowrap px-2 py-1 text-[10.5px]"
            >
              💾 Save
            </button>
          </div>
          {settings.presets.length > 0 ? (
            <ul className="space-y-1">
              {settings.presets.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded bg-white/[0.03] px-2 py-1 text-[10.5px]">
                  <span className="select-all text-text-secondary">{p.name}</span>
                  <button type="button" onClick={() => deletePreset(p.id)} className="text-text-muted hover:text-red-400">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {/* ------------------------- RIGHT: results ------------------------- */}
      <section className="space-y-3" aria-label="Finder results">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-bg-card p-2.5">
          <span className="rounded-full border border-emerald-500/45 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
            <span className="mono-num">{results.length}</span> coins match · updated live
          </span>
          <div className="flex gap-1.5">
            <button type="button" onClick={copyWatchlist} className="btn-ghost whitespace-nowrap">
              ⧉ Copy TradingView Watchlist (.txt)
            </button>
            <button type="button" onClick={exportCsv} className="btn-ghost whitespace-nowrap">
              ⭳ Export CSV
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-bg-card">
          <div className="max-h-[62vh] overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-bg-card-2 text-[10.5px] font-bold text-text-secondary">
                <tr>
                  <th className="px-2 py-1.5 text-left">Coin</th>
                  <th className="px-2 py-1.5 text-right">Price</th>
                  <th className="px-2 py-1.5 text-right">24h %</th>
                  <th className="px-2 py-1.5 text-right">RSI</th>
                  <th className="px-2 py-1.5 text-right">RVOL</th>
                  <th className="px-2 py-1.5 text-right">Volume</th>
                  <th className="px-2 py-1.5 text-left">Match Score</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 200).map(({ coin, score, reasons }) => (
                  <Fragment key={coin.symbol}>
                    <tr
                      className="cursor-pointer border-b border-white/[0.03] hover:bg-bg-hover"
                      onClick={() => setExpanded((e) => (e === coin.symbol ? null : coin.symbol))}
                    >
                      <td className="px-2 py-1.5">
                        <span className="select-all font-bold text-white">{coin.baseAsset}</span>
                        {coin.isMonitoringTag ? <span className="ml-1 text-amber-400">⚠</span> : null}
                      </td>
                      <td className="mono-num px-2 py-1.5 text-right">{formatPrice(coin.price)}</td>
                      <td className={`mono-num px-2 py-1.5 text-right font-semibold ${coin.changePct24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatPct(coin.changePct24h)}
                      </td>
                      <td className="mono-num px-2 py-1.5 text-right">{formatRsi(coin.rsi)}</td>
                      <td className="mono-num px-2 py-1.5 text-right text-amber-400">{formatRvol(coin.rvol)}</td>
                      <td className="mono-num px-2 py-1.5 text-right text-text-secondary">{formatVolume(coin.quoteVol24h)}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-[6px] w-20 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full ${score >= 75 ? 'bg-emerald-500' : score >= 55 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                          <span className="mono-num text-[10.5px] font-bold text-white">{score}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <a
                          href={tradingViewLink(coin.baseAsset, timeframe)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] text-text-secondary hover:text-white"
                        >
                          Chart ↗
                        </a>
                      </td>
                    </tr>
                    {expanded === coin.symbol ? (
                      <tr className="border-b border-white/[0.03] bg-white/[0.02]">
                        <td colSpan={8} className="px-3 py-2">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">Why it matched</div>
                          <ul className="flex flex-wrap gap-1">
                            {reasons.map((r) => (
                              <li key={r}>
                                <Pill tone="blue">{r}</Pill>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 flex items-center gap-2">
                            <CopyButton value={coin.symbol} label="symbol" compact />
                            <span className="mono-num text-[10.5px] text-text-muted">
                              EMA9 {formatPrice(coin.ema9)} · EMA21 {formatPrice(coin.ema21)} · EMA50 {formatPrice(coin.ema50)} · ATR{' '}
                              {coin.atrPct.toFixed(2)}% · Spread {coin.spreadPct.toFixed(3)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {results.length === 0 ? (
          <p className="rounded-xl border border-white/[0.06] bg-bg-card p-6 text-center text-[12px] text-text-muted">
            No coins match the current filters. Loosen the spread, RVOL or volume floor to widen the net.
          </p>
        ) : null}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function fieldValue(coin: CoinSnapshot, field: FieldKey): number {
  switch (field) {
    case 'rsi':
      return coin.rsi;
    case 'rsiDelta':
      return coin.rsiDelta;
    case 'alphaSniper':
      return coin.alphaSniper;
    case 'ema9v21':
      return coin.ema21 !== 0 ? ((coin.ema9 - coin.ema21) / coin.ema21) * 100 : 0;
    case 'ema21v50':
      return coin.ema50 !== 0 ? ((coin.ema21 - coin.ema50) / coin.ema50) * 100 : 0;
    case 'priceVsEma21':
      return coin.ema21 !== 0 ? ((coin.price - coin.ema21) / coin.ema21) * 100 : 0;
    case 'atrPct':
      return coin.atrPct;
    case 'rvol':
      return coin.rvol;
    default:
      return 0;
  }
}

function evaluate(coin: CoinSnapshot, cond: Condition): boolean {
  const v = fieldValue(coin, cond.field);
  switch (cond.op) {
    case '>':
      return v > cond.value;
    case '<':
      return v < cond.value;
    case '≥':
      return v >= cond.value;
    case '≤':
      return v <= cond.value;
    case 'between':
      return v >= Math.min(cond.value, cond.value2) && v <= Math.max(cond.value, cond.value2);
    default:
      return true;
  }
}

/**
 * §7.3  The Coin Finder reuses the identical 0–100 budget used by all five
 * scanners, so a match here scores the same as a signal card there.
 */
function matchScore(coin: CoinSnapshot): number {
  const long = coin.ema9 >= coin.ema21;
  const fullStack = long
    ? coin.ema9 > coin.ema21 && coin.ema21 > coin.ema50
    : coin.ema9 < coin.ema21 && coin.ema21 < coin.ema50;
  const zone = zoneForRsi(coin.rsi).id;
  const stage = zone === 'V1' || zone === 'HIDDEN_BULL' ? 'WAITING' : 'POTENTIAL';

  const { total } = computeScore({
    scannerSlug: 'coin-finder',
    stage,
    rvol: coin.rvol,
    fullEmaStack: fullStack,
    partialEma: true,
    bodyRatio: Math.abs(coin.price - coin.open) / Math.max(coin.high - coin.low, 1e-9),
    htfAlignment: 'NEUTRAL',
    rr: coin.atr > 0 ? 1.8 : 0,
    quoteVol24h: coin.quoteVol24h,
    spreadPct: coin.spreadPct,
    isMonitoringTag: coin.isMonitoringTag,
  });
  return total;
}

function whyMatched(coin: CoinSnapshot, conditions: Condition[]): string[] {
  const out: string[] = [];
  const zone = zoneForRsi(coin.rsi);
  out.push(`RSI ${coin.rsi.toFixed(1)} (${zone.filterLabel})`);
  if (coin.rsiDelta > 0) out.push(`RSI rising +${coin.rsiDelta.toFixed(2)}`);
  else if (coin.rsiDelta < 0) out.push(`RSI falling ${coin.rsiDelta.toFixed(2)}`);
  out.push(`RVOL ${coin.rvol.toFixed(2)}×`);

  if (coin.ema9 > coin.ema21 && coin.ema21 > coin.ema50) out.push('EMA9 > EMA21 > EMA50');
  else if (coin.ema9 < coin.ema21 && coin.ema21 < coin.ema50) out.push('EMA9 < EMA21 < EMA50');

  if (coin.obStatus === 'DEMAND_BUY') out.push('Price trading into a bullish demand OB');
  if (coin.obStatus === 'SUPPLY_WAIT') out.push('Price testing a bearish supply OB');

  const dist = coin.ema21 !== 0 ? ((coin.price - coin.ema21) / coin.ema21) * 100 : 0;
  out.push(`${dist >= 0 ? '+' : ''}${dist.toFixed(2)}% vs EMA21`);

  for (const c of conditions) {
    const label = FIELDS.find((f) => f.key === c.field)?.label ?? c.field;
    out.push(`${label} ${c.op} ${c.value}`);
  }

  if (coin.isMonitoringTag) out.push('⚠ Monitoring Tag Risk');
  return out;
}
