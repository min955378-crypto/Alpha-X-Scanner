'use client';

import { useCallback, useEffect, useState } from 'react';

import { formatCountdown, formatDateShort } from '@/lib/format';
import type { RiskCategory, RiskWatchItem, RiskWatchState } from '@/lib/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Pill } from '@/components/ui';
import { TiltCard } from '@/components/ui/Motion3D';

/**
 * §8  Tab 7 — Binance Risk Watch.
 * Hero + 4 KPI cards + three scrollable columns (Monitoring Tag / Delisting
 * Notices / Spot News), fed by the live BAPI CMS pipeline with a non-blanking
 * cached-snapshot fallback.
 */
export function RiskWatchView() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { push } = useToast();

  const [state, setState] = useState<RiskWatchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [nextIn, setNextIn] = useState(3600);
  const [refreshing, setRefreshing] = useState(false);
  const [archive, setArchive] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/risk-watch', { cache: 'no-store' });
      const data = (await res.json()) as { items: RiskWatchItem[]; updatedAt: number; nextUpdateSec: number; lastError: string | null };
      setState({
        items: data.items ?? [],
        updatedAt: data.updatedAt ?? Date.now(),
        nextUpdateSec: data.nextUpdateSec ?? 3600,
        source: data.lastError ? 'CACHED_SNAPSHOT' : 'LIVE_BAPI',
        lastError: data.lastError,
      });
      setNextIn(data.nextUpdateSec ?? 3600);
    } catch {
      push({ title: 'Risk Watch unavailable', body: 'Could not load the safety centre.', level: 'error' });
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNextIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/risk-watch', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; error?: string; retryAfterSec?: number; source?: string };
      if (!res.ok || !data.ok) {
        push({
          title: 'Refresh rate-limited',
          body: `Protected by a 60s lock. Try again in ${data.retryAfterSec ?? 60}s.`,
          level: 'warn',
        });
      } else {
        push({ title: 'Risk Watch refreshed', body: `Source: ${data.source}`, level: 'success' });
      }
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load, push]);

  const monitoring = state?.items.filter((i) => i.category === 'MONITORING_TAG') ?? [];
  const notices = state?.items.filter((i) => i.category === 'DELISTING_NOTICE') ?? [];
  const news = state?.items.filter((i) => i.category === 'SPOT_NEWS') ?? [];

  const now = Date.now();
  const effectiveNotices = archive ? notices : notices.filter((n) => !n.effectiveDelistDate || n.effectiveDelistDate >= now - 86_400_000);

  return (
    <div className="space-y-3">
      {/* ----------------------------- HERO ----------------------------- */}
      <section className="card overflow-hidden" style={{ borderLeft: '3px solid #F5B301' }}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-3">
          <div>
            <div className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-amber-400">BINANCE MARKET SAFETY</div>
            <h1 className="mt-0.5 text-[20px] font-bold text-white">⚠ Binance Risk Watch</h1>
            <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-text-secondary">
              Monitoring tags, official delisting notices and the latest Binance Spot news in one place.
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Auto Refresh: Every 1 Hour
            </div>
            <span className="mono-num text-[10px] text-text-secondary">Next update in {formatCountdown(nextIn)}</span>
            <button type="button" onClick={refresh} disabled={refreshing} className="btn-amber disabled:opacity-50">
              ↻ {refreshing ? 'Refreshing…' : 'Refresh Now'}
              {user?.role === 'ADMIN' ? ' (Admin)' : ''}
            </button>
            {state?.source === 'CACHED_SNAPSHOT' ? (
              <span
                title={state.lastError ?? 'Binance CMS unreachable'}
                className="mono-num rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-400"
              >
                CACHED SNAPSHOT
              </span>
            ) : (
              <span className="mono-num rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-400">
                LIVE BAPI
              </span>
            )}
          </div>
        </div>
      </section>

      {/* --------------------------- 4 KPI CARDS --------------------------- */}
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard value={monitoring.length} label="Monitoring Tags" color="#F5B301" />
        <KpiCard value={notices.length} label="Delisting Notices" color="#F87171" />
        <KpiCard value={news.length} label="Binance Spot News" color="#60A5FA" />
        <div
          className="card flex flex-col items-center justify-center py-3"
          style={{ borderBottom: '2px solid #22C55E' }}
        >
          <div className="text-[26px] font-extrabold leading-none text-white">
            {state ? new Date(state.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: !settings.clock24, timeZone: settings.timezone }) : '—'}
          </div>
          <div className="mt-1 text-[10.5px] font-semibold text-text-secondary">Last Updated</div>
        </div>
      </section>

      {/* ------------------------- THREE COLUMNS ------------------------- */}
      <section className="grid gap-3 lg:grid-cols-3">
        <RiskColumn
          badge="M"
          badgeTone="amber"
          title="Monitoring Tag"
          subtitle="Higher-risk assets"
          items={monitoring.map((i) => ({ ...i, rowTitle: i.symbol ?? i.title }))}
          loading={loading}
          emptyLabel="No monitoring tags"
          footerNote="Monitoring Tag is a risk warning, not confirmation of delisting."
        />

        <RiskColumn
          badge="D"
          badgeTone="red"
          title="Upcoming Delisting Notices"
          subtitle="Official Binance announcements"
          items={effectiveNotices}
          loading={loading}
          emptyLabel="No delisting notices"
          filter={
            <div className="flex gap-1">
              {[
                { id: false, label: 'Active / Upcoming' },
                { id: true, label: 'Archive' },
              ].map((o) => (
                <button
                  key={String(o.id)}
                  type="button"
                  aria-pressed={archive === o.id}
                  onClick={() => setArchive(o.id)}
                  className={`rounded-full border px-2 py-0.5 text-[9.5px] font-semibold ${
                    archive === o.id
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-white/10 bg-white/[0.03] text-text-secondary hover:text-white'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          }
        />

        <RiskColumn
          badge="N"
          badgeTone="blue"
          title="Binance Spot News"
          subtitle="Listings and Spot updates"
          items={news}
          loading={loading}
          emptyLabel="No spot news"
        />
      </section>
    </div>
  );
}

function KpiCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    /* §Phase 2 §2.3 — 3D tilt + cursor spotlight on all 4 Binance Risk Watch KPI cards. */
    <TiltCard max={6} className="rounded-lg">
      <div
        className="card flex h-full flex-col items-center justify-center py-3"
        style={{ borderBottom: `2px solid ${color}` }}
      >
        <div className="mono-num text-[26px] font-extrabold leading-none" style={{ color }}>
          {value}
        </div>
        <div className="mt-1 text-[10.5px] font-semibold text-text-secondary">{label}</div>
      </div>
    </TiltCard>
  );
}

function RiskColumn({
  badge,
  badgeTone,
  title,
  subtitle,
  items,
  loading,
  emptyLabel,
  filter,
  footerNote,
}: {
  badge: string;
  badgeTone: 'amber' | 'red' | 'blue';
  title: string;
  subtitle: string;
  items: Array<RiskWatchItem & { rowTitle?: string }>;
  loading: boolean;
  emptyLabel: string;
  filter?: React.ReactNode;
  footerNote?: string;
}) {
  const { settings } = useSettings();
  const tone =
    badgeTone === 'amber'
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
      : badgeTone === 'red'
        ? 'bg-red-500/20 text-red-400 border-red-500/40'
        : 'bg-blue-500/20 text-blue-400 border-blue-500/40';

  return (
    <div className="card flex max-h-[540px] flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-white/[0.06] p-2.5">
        <div className="flex items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded border text-[11px] font-extrabold ${tone}`} aria-hidden="true">
            {badge}
          </span>
          <div>
            <h2 className="text-[12.5px] font-bold text-white">{title}</h2>
            <p className="text-[10px] text-text-muted">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {filter}
          <span className="mono-num text-[10px] text-text-muted">{items.length}</span>
        </div>
      </header>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[38px] animate-pulse rounded bg-white/[0.04]" />)
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-text-muted">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <RiskRow key={item.id} item={item} title={item.rowTitle ?? item.title} tz={settings.timezone} />
          ))
        )}
      </div>

      {footerNote ? (
        <p className="border-t border-white/[0.06] p-2 text-[9.5px] leading-relaxed text-text-muted">{footerNote}</p>
      ) : null}
    </div>
  );
}

function RiskRow({ item, title, tz }: { item: RiskWatchItem; title: string; tz: string }) {
  const badgeTone =
    item.badgeType === 'Monitoring'
      ? 'amber'
      : item.badgeType === 'Trading Pairs'
        ? 'purple'
        : 'red';

  const href =
    item.category === 'MONITORING_TAG'
      ? `https://www.tradingview.com/chart/?symbol=BINANCE:${item.symbol}USDT&interval=60`
      : item.sourceUrl;

  const sub =
    item.category === 'MONITORING_TAG'
      ? 'Open TradingView · 1H'
      : `Published ${formatDateShort(item.publishedAt, tz)} · Open announcement ↗`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 rounded border border-white/[0.05] bg-white/[0.02] px-2 py-1.5 transition-colors hover:border-white/15 hover:bg-white/[0.05]"
    >
      <div className="min-w-0">
        <div className="select-all truncate text-[11.5px] font-bold text-white" title={title}>
          {title}
        </div>
        <div className="truncate text-[10px] text-text-secondary">{sub}</div>
      </div>
      <Pill tone={badgeTone} className="shrink-0">
        {item.badgeType}
      </Pill>
    </a>
  );
}

export type { RiskCategory };
