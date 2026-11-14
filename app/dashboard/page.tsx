'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { AppShell } from '@/components/shell/AppShell';
import { HeatmapView } from '@/components/dashboard/HeatmapView';
import { ProTableView } from '@/components/dashboard/ProTableView';
import { CoinFinderView } from '@/components/dashboard/CoinFinderView';
import { RightSidebar } from '@/components/dashboard/RightSidebar';
import { WatchlistView } from '@/components/dashboard/WatchlistView';
import { Segmented } from '@/components/ui';
import { useMarket } from '@/components/providers/MarketProvider';
import { useSettings } from '@/components/providers/SettingsProvider';

type View = 'HEATMAP' | 'PRO_TABLE' | 'COIN_FINDER' | 'WATCHLIST';

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { frame, countdown, timeframe } = useMarket();
  const { settings, update, hydrated } = useSettings();

  const viewParam = (params.get('view') ?? '').toUpperCase();
  const view: View =
    viewParam === 'table'
      ? 'PRO_TABLE'
      : viewParam === 'finder'
        ? 'COIN_FINDER'
        : viewParam === 'watchlist'
          ? 'WATCHLIST'
          : settings.activeView;

  const setView = (v: View) => {
    update('activeView', v);
    const slug = v === 'PRO_TABLE' ? 'table' : v === 'COIN_FINDER' ? 'finder' : v === 'WATCHLIST' ? 'watchlist' : 'heatmap';
    router.replace(`/dashboard?view=${slug}`, { scroll: false });
  };

  // Keep the engine's active timeframe in step with the user's saved default.
  useEffect(() => {
    if (hydrated) document.title = 'ScalpPro v2 — Dashboard';
  }, [hydrated]);

  return (
    <AppShell rightSidebar={<RightSidebar frame={frame} />}>
      <main className="min-w-0 flex-1 space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'HEATMAP', label: '🔥 Heatmap' },
              { value: 'PRO_TABLE', label: '📋 Pro Table' },
              { value: 'COIN_FINDER', label: '🔍 Coin Finder' },
              { value: 'WATCHLIST', label: '★ Watchlist' },
            ]}
          />
          <span className="mono-num text-[10.5px] text-text-muted">
            {frame ? `${frame.counts.enabled} coins · ${timeframe} · cycle #${frame.cycle}` : 'connecting…'}
          </span>
        </div>

        {view === 'HEATMAP' ? <HeatmapView frame={frame} countdown={countdown} timeframe={timeframe} /> : null}
        {view === 'PRO_TABLE' ? <ProTableView frame={frame} timeframe={timeframe} /> : null}
        {view === 'COIN_FINDER' ? <CoinFinderView frame={frame} timeframe={timeframe} /> : null}
        {view === 'WATCHLIST' ? <WatchlistView frame={frame} timeframe={timeframe} /> : null}
      </main>
    </AppShell>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-canvas">
      <div className="text-center">
        <div className="text-[18px] font-bold text-white">ScalpPro</div>
        <div className="mt-1 text-[11px] text-text-muted">Loading your terminal…</div>
      </div>
    </div>
  );
}
