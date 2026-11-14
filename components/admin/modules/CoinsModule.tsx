'use client';

import { useMemo, useState } from 'react';

import { SCANNERS } from '@/lib/types';
import type { ScannerSlug, Timeframe } from '@/lib/types';
import { Btn, Card, Empty, Field, PillSelect, TextInput } from '../shared';
import { TIMEFRAME_OPTIONS } from '../types';
import type { CoinRow, Overview } from '../types';

/**
 * MODULE 6  Coin Universe (612+) & Manual VIP Signal Injector.
 *
 * Two real subsystems:
 *  - Enable/disable coins for the heatmap and scanners.
 *  - Toggle the ⚠ Monitoring Tag, with `manualTagOverride` so the owner's
 *    choice is never silently reverted by the next automatic risk sync.
 *  - Publish a hand-picked VIP signal that every customer sees pinned at the
 *    top of the relevant scanner panel, with the standard entry chime.
 */

export function CoinsModule({
  data,
  reload,
  toast,
}: {
  data: Overview;
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ENABLED' | 'DISABLED' | 'TAGGED'>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase();
    return data.coins
      .filter((c) => (q ? c.symbol.includes(q) || c.baseAsset.includes(q) : true))
      .filter((c) => {
        if (filter === 'ENABLED') return c.enabled;
        if (filter === 'DISABLED') return !c.enabled;
        if (filter === 'TAGGED') return c.isMonitoringTag;
        return true;
      })
      .slice(0, 300);
  }, [data.coins, query, filter]);

  const toggle = async (coin: CoinRow, patch: { enabled?: boolean; isMonitoringTag?: boolean }) => {
    setBusyId(coin.symbol);
    try {
      const res = await fetch('/api/admin/coins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol: coin.symbol, ...patch }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast('Could not update this coin.', 'warn');
        return;
      }
      await reload();
    } catch {
      toast('Network error — nothing changed.', 'warn');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <VipSignalInjector reload={reload} toast={toast} />

      <Card
        title="Coin Universe"
        icon="layers"
        subtitle={`${data.kpis.universeEnabled} enabled of ${data.kpis.universeTotal} USDT pairs · showing first ${visible.length}`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <PillSelect
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'ENABLED', label: 'Enabled' },
                { value: 'DISABLED', label: 'Disabled' },
                { value: 'TAGGED', label: '⚠ Monitoring' },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <div className="w-44">
              <TextInput value={query} onChange={setQuery} placeholder="Search BTC, ETH…" mono />
            </div>
          </div>
        }
      >
        {visible.length === 0 ? (
          <Empty>No coins match this filter.</Empty>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-bg-card text-[9.5px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-3 py-1.5 font-bold">Symbol</th>
                  <th className="px-2 py-1.5 font-bold">Price</th>
                  <th className="px-2 py-1.5 font-bold">24h</th>
                  <th className="px-2 py-1.5 font-bold">Quote Vol</th>
                  <th className="px-2 py-1.5 text-center font-bold">Scan</th>
                  <th className="px-3 py-1.5 text-center font-bold">⚠ Monitor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {visible.map((c) => (
                  <tr key={c.symbol} className="text-[11px] hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5">
                      <span className="mono-num font-bold text-white">{c.baseAsset}</span>
                      <span className="mono-num ml-1 text-[9.5px] text-text-muted">/USDT</span>
                      {c.manualTagOverride ? (
                        <span className="ml-1.5 rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[8.5px] font-bold text-violet-300">
                          MANUAL
                        </span>
                      ) : null}
                    </td>
                    <td className="mono-num px-2 py-1.5 text-text-bright">{fmtPrice(c.price)}</td>
                    <td className={`mono-num px-2 py-1.5 font-semibold ${c.changePct24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {c.changePct24h >= 0 ? '+' : ''}
                      {c.changePct24h.toFixed(2)}%
                    </td>
                    <td className="mono-num px-2 py-1.5 text-text-muted">{fmtVol(c.quoteVol24h)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        disabled={busyId === c.symbol}
                        onChange={(e) => void toggle(c, { enabled: e.target.checked })}
                        className="h-3.5 w-3.5 accent-emerald-500"
                        aria-label={`Enable ${c.symbol} for scanning`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button
                        type="button"
                        disabled={busyId === c.symbol}
                        onClick={() => void toggle(c, { isMonitoringTag: !c.isMonitoringTag })}
                        className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold transition-colors ${
                          c.isMonitoringTag
                            ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                            : 'border-white/10 bg-white/[0.03] text-text-muted hover:bg-white/[0.07]'
                        }`}
                        aria-pressed={c.isMonitoringTag}
                      >
                        {c.isMonitoringTag ? '⚠ TAGGED' : 'Tag'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------- VIP injector ------------------------------- */

function VipSignalInjector({
  reload,
  toast,
}: {
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [scanner, setScanner] = useState<ScannerSlug>('alpha-sniper');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1H');
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp1, setTp1] = useState('');
  const [tp2, setTp2] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = useMemo(() => {
    const e = Number(entry);
    const s = Number(sl);
    const t1 = Number(tp1);
    if (!(e > 0) || !(s > 0) || !(t1 > 0)) return null;
    /* Geometry must make sense for the chosen side, or the card misleads. */
    if (direction === 'LONG' ? !(s < e && t1 > e) : !(s > e && t1 < e)) return null;
    const t2 = tp2.trim() ? Number(tp2) : null;
    if (t2 !== null && (!Number.isFinite(t2) || (direction === 'LONG' ? t2 <= t1 : t2 >= t1))) return null;
    return { e, s, t1, t2 };
  }, [direction, entry, sl, tp1, tp2]);

  const publish = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/signals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scannerSlug: scanner,
          symbol: symbol.trim().toUpperCase(),
          timeframe,
          direction,
          entryPrice: valid.e,
          invalidationPrice: valid.s,
          tp1Price: valid.t1,
          tp2Price: valid.t2,
          score: 95,
          reasons: reason.trim() ? [reason.trim()] : [],
          note: reason.trim() || null,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast(VIP_ERRORS[json.error ?? 'UNKNOWN'] ?? 'Could not publish this signal.', 'warn');
        return;
      }
      toast('VIP signal published — it is now pinned at the top for every customer.');
      setReason('');
      await reload();
    } catch {
      toast('Network error — nothing was published.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Manual VIP Signal Injector"
      icon="bolt"
      subtitle="Publishes a 95/100 hand-picked setup that appears pinned above engine output on every customer's panel, with the standard entry chime."
    >
      <div className="space-y-2.5 p-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Target Scanner">
            <select
              value={scanner}
              onChange={(e) => setScanner(e.target.value as ScannerSlug)}
              className="input h-7 w-full"
            >
              {SCANNERS.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Symbol">
            <TextInput value={symbol} onChange={setSymbol} placeholder="BTCUSDT" mono />
          </Field>
          <Field label="Timeframe">
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="input h-7 w-full"
            >
              {TIMEFRAME_OPTIONS.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Direction">
            <PillSelect
              options={[
                { value: 'LONG', label: '🟢 LONG' },
                { value: 'SHORT', label: '🔴 SHORT' },
              ]}
              value={direction}
              onChange={setDirection}
            />
          </Field>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Entry Price">
            <TextInput value={entry} onChange={setEntry} placeholder="0.00" mono />
          </Field>
          <Field label="Stop Loss">
            <TextInput value={sl} onChange={setSl} placeholder="0.00" mono />
          </Field>
          <Field label="Take Profit 1">
            <TextInput value={tp1} onChange={setTp1} placeholder="0.00" mono />
          </Field>
          <Field label="Take Profit 2 (optional)">
            <TextInput value={tp2} onChange={setTp2} placeholder="0.00" mono />
          </Field>
        </div>

        <Field label="Custom Reason Tag" hint="Shown as the first reason line on the signal card.">
          <TextInput value={reason} onChange={setReason} placeholder="Institutional order flow + HTF confluence" />
        </Field>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2.5">
          <Btn tone="green" icon="bolt" busy={busy} disabled={!valid} onClick={publish}>
            ⚡ Publish VIP Signal to All Users
          </Btn>
          {!valid ? (
            <span className="text-[9.5px] text-amber-400">
              Geometry check: for {direction}, SL must be {direction === 'LONG' ? 'below' : 'above'} entry and TP1{' '}
              {direction === 'LONG' ? 'above' : 'below'} it (TP2 beyond TP1).
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p === 0) return '—';
  return p >= 1000 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(8).replace(/0+$/, '');
}

function fmtVol(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

const VIP_ERRORS: Record<string, string> = {
  BAD_SCANNER: 'Pick one of the five scanners.',
  BAD_SYMBOL: 'Symbols must end in USDT (e.g. BTCUSDT).',
  BAD_PRICE: 'Entry, stop loss and TP1 must all be positive numbers.',
  BAD_LONG_GEOMETRY: 'For a LONG, the stop loss must be below entry and TP1 above it.',
  BAD_SHORT_GEOMETRY: 'For a SHORT, the stop loss must be above entry and TP1 below it.',
  FORBIDDEN: 'Admin access required.',
};
