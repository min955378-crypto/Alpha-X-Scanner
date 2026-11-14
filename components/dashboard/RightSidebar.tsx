'use client';

import { useState } from 'react';

import { BRAND } from '@/lib/constants';
import { formatPct, tradingViewLink } from '@/lib/format';
import { SCANNERS, TIMEFRAMES, type MarketFrame, type Timeframe } from '@/lib/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useMarket } from '@/components/providers/MarketProvider';
import { Icon } from '@/components/ui/Icons';

/**
 * §6.6  Right sidebar (190px): Top Movers · Active Scanners · Chart Settings ·
 * Muhammad Ibrahim promo card.
 */
export function RightSidebar({ frame }: { frame: MarketFrame | null }) {
  const { settings, update } = useSettings();
  const { setTimeframe, timeframe, livePrices, tickVersion } = useMarket();
  const [saved, setSaved] = useState(false);

  const movers = frame?.topMovers ?? [];

  const saveTimeframe = async (tf: Timeframe) => {
    setTimeframe(tf);
    update('timeframe', tf);
    await fetch('/api/user/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredTimeframe: tf }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <aside className="w-full space-y-3 lg:w-sidebar" aria-label="Market sidebar">
      {/* 🔥 Top Movers */}
      <div className="card p-2.5">
        <h3 className="mb-2 text-[12px] font-bold text-white">🔥 Top Movers</h3>
        <ul className="mono-num space-y-1.5 text-[11.5px]">
          {movers.map((m) => (
            <li key={m.symbol}>
              <a
                href={tradingViewLink(m.baseAsset, timeframe)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 hover:underline"
              >
                <span className="select-all text-white">
                  {m.baseAsset}
                  {m.isMonitoringTag ? <span className="text-amber-400"> ⚠</span> : null}
                </span>
                <span className="font-semibold text-emerald-400">{formatPct(m.changePct24h)}</span>
              </a>
            </li>
          ))}
          {movers.length === 0 ? <li className="text-[11px] text-text-muted">Loading…</li> : null}
        </ul>
      </div>

      {/* ⚙ Active Scanners */}
      <div className="card p-2.5">
        <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-white"><Icon name="bolt" size={13} className="text-emerald-400" /> Active Scanners</h3>
        <ul className="space-y-1.5 text-[11.5px]">
          {SCANNERS.map((s) => (
            <li key={s.slug} className="flex items-center justify-between gap-2">
              <span className="text-text-secondary">{s.sidebarLabel}</span>
              <span className={scannerRunning(s.slug) ? 'font-semibold text-emerald-400' : 'text-text-muted'}>
                {scannerRunning(s.slug) ? 'Running' : 'Idle'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ⚙ Chart Settings */}
      <div className="card space-y-2 p-2.5">
        <h3 className="flex items-center gap-1.5 text-[12px] font-bold text-white"><Icon name="settings" size={13} className="text-emerald-400" /> Chart Settings</h3>
        <label className="block text-[10.5px] text-text-secondary" htmlFor="tv-tf">
          TradingView Timeframe
        </label>
        <select
          id="tv-tf"
          value={timeframe}
          onChange={(e) => void saveTimeframe(e.target.value as Timeframe)}
          className="input"
        >
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void saveTimeframe(timeframe)}
          className="h-7 w-full rounded border border-emerald-500/50 bg-emerald-500/10 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
        >
          💾 Save
        </button>
        {saved ? <div className="text-center text-[10px] font-semibold text-emerald-400">Saved ✓</div> : null}
      </div>

      {/* Muhammad Ibrahim promo card */}
      <div className="card space-y-2 p-3 text-center">
        <Equalizer />
        <div className="text-[12px] font-bold text-white">{BRAND.promoHeadline}</div>
        <p className="text-[10.5px] leading-relaxed text-text-secondary">{BRAND.promoTagline}</p>
        <div className="text-[9.5px] font-bold uppercase tracking-wider text-cyan-400">CONTACT US</div>
        <a
          href={BRAND.whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mono-num inline-flex select-all items-center justify-center gap-1.5 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/25"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {BRAND.whatsappContact}
        </a>
      </div>

      {/* Live price sample — proves the 1 Hz tick overlay is wired up. */}
      <div className="card p-2.5" key={tickVersion}>
        <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-white"><Icon name="activity" size={13} className="text-emerald-400" /> Live Ticks</h3>
        <ul className="mono-num space-y-1 text-[11px]">
          {movers.slice(0, 3).map((m) => {
            const live = livePrices.current.get(m.symbol);
            return (
              <li key={m.symbol} className="flex justify-between">
                <span className="text-text-secondary">{m.baseAsset}</span>
                <span className="text-white">{live ? live[0].toPrecision(6) : '—'}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

/** Scanner running state is owned by each scanner page; the sidebar mirrors it. */
function scannerRunning(slug: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(`alpha-x-scanner:scanner:${slug}`) === 'running';
}

/** 5-bar animated equalizer from the promo card ([SEEN IN VIDEO]). */
function Equalizer() {
  return (
    <div className="flex h-6 items-end justify-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom rounded-sm bg-emerald-500 animate-eq"
          style={{ height: 14 + (i % 3) * 5, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
