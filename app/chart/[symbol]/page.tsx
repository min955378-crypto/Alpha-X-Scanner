'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import type { Timeframe } from '@/lib/types';
import { AppShell } from '@/components/shell/AppShell';
import { ChartHeadline, ChartMetrics, ChartStudio, useSymbolSetup, type ChartMode } from '@/components/chart/ChartStudio';
import { useMarket } from '@/components/providers/MarketProvider';
import { useSettings } from '@/components/providers/SettingsProvider';

/**
 * §4.4  DUAL LIVE CHARTING ENGINE.
 *
 *   Mode A — Alpha X Native Sniper Chart (TradingView Lightweight Charts,
 *            HTML5 canvas): live candles + EMA 13/34 + order-block zones +
 *            500-candle backtest HUD + synchronised Alpha Sniper oscillator.
 *   Mode B — TradingView Advanced Real-Time Widget (s3.tradingview.com/tv.js)
 *            bound to BINANCE:<symbol> in the user's timeframe, dark theme.
 *
 * Plus the 1-click [Open in TradingView ↗] deep link.
 *
 * The chosen mode persists to the account (`chartMode`) so every chart and the
 * quick-chart drawer open the way the trader left them.
 */

export default function ChartPage() {
  return (
    <Suspense fallback={null}>
      <ChartInner />
    </Suspense>
  );
}

function ChartInner() {
  const params = useParams<{ symbol: string }>();
  const search = useSearchParams();
  const { frame } = useMarket();
  const { settings, update } = useSettings();

  const base = (params.symbol ?? 'BTC').toUpperCase();
  const symbol = `${base}USDT`;

  const [tf, setTf] = useState<Timeframe>((search.get('tf') as Timeframe) ?? settings.timeframe);
  const [mode, setMode] = useState<ChartMode>(settings.chartMode === 'EXTERNAL_TV' ? 'EXTERNAL_TV' : 'INTERNAL');
  const [scripts, setScripts] = useState<{ overlay: string; sniper: string } | null>(null);


  const persistMode = useCallback(
    (next: ChartMode) => {
      setMode(next);
      void update('chartMode', next);
    },
    [update],
  );

  useEffect(() => {
    Promise.all([
      fetch('/pine/alpha-x-overlay.pine').then((r) => r.text()),
      fetch('/pine/alpha-sniper.pine').then((r) => r.text()),
    ]).then(([overlay, sniper]) => setScripts({ overlay, sniper }));
  }, []);

  const coin = frame?.coins.find((c) => c.baseAsset === base || c.symbol === base);
  const { setup, scanner } = useSymbolSetup(symbol);

  return (
    <AppShell>
      <main className="min-w-0 flex-1 space-y-3 p-3">
        <header className="card p-3">
          <ChartHeadline base={base} coin={coin} />
          {scanner && setup ? (
            <p className="mt-1.5 text-[10px] text-text-muted">
              Levels drawn from the live{' '}
              <span className="font-semibold text-amber-400">{scanner.replace(/-/g, ' ')}</span> setup on this pair.
            </p>
          ) : null}
        </header>

        <ChartMetrics coin={coin} />

        <ChartStudio
          symbol={symbol}
          tf={tf}
          mode={mode}
          onTfChange={(v) => {
            setTf(v);
            update('timeframe', v);
          }}
          onModeChange={persistMode}
          height={460}
          setup={setup}
        />

        <section className="grid gap-3 xl:grid-cols-2">
          <ScriptCard
            title="Alpha X Scanner Overlay — Dual EMA + 500-Candle Backtest"
            file="/pine/alpha-x-overlay.pine"
            body={scripts?.overlay ?? 'Loading…'}
            note="Script 1 • overlay=true • max_bars_back=600 • SL-first, no entry-bar exit."
          />
          <ScriptCard
            title="Alpha Sniper — 30–70 purple channel oscillator"
            file="/pine/alpha-sniper.pine"
            body={scripts?.sniper ?? 'Loading…'}
            note="Script 2 • overlay=false • EMA(RSI(14), 3) with 30 / 50 / 70 triggers."
          />
        </section>
      </main>
    </AppShell>
  );
}

function ScriptCard({
  title,
  file,
  body,
  note,
}: {
  title: string;
  file: string;
  body: string;
  note: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <article className="card flex flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-white/[0.06] p-2.5">
        <div>
          <h3 className="text-[12.5px] font-bold text-white">{title}</h3>
          <p className="text-[10px] text-text-muted">{note}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(body);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-ghost whitespace-nowrap"
          >
            {copied ? 'Copied! ✓' : '⧉ Copy Pine'}
          </button>
          <a href={file} download className="btn-ghost whitespace-nowrap">
            ⭳ .pine
          </a>
        </div>
      </header>
      <pre className="mono-num max-h-[380px] overflow-auto p-3 text-[10.5px] leading-relaxed text-text-bright">
        {body}
      </pre>
    </article>
  );
}
