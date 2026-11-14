'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { BRAND } from '@/lib/constants';
import { formatPct, formatPrice, formatRsi, formatRvol, tradingViewLink } from '@/lib/format';
import type { Candle } from '@/lib/indicators';
import { TF_TO_TV, TIMEFRAMES, zoneForRsi, type Timeframe } from '@/lib/types';
import { AppShell } from '@/components/shell/AppShell';
import { CopyButton, Pill, Segmented } from '@/components/ui';
import { Icon } from '@/components/ui/Icons';
import { SniperChart } from '@/components/chart/SniperChart';
import { TradingViewAdvanced } from '@/components/chart/TradingViewAdvanced';
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

type ChartMode = 'INTERNAL' | 'EXTERNAL_TV';

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
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scripts, setScripts] = useState<{ overlay: string; sniper: string } | null>(null);

  /* Mode A needs real candle history — served from the warm engine snapshot. */
  useEffect(() => {
    if (mode !== 'INTERNAL') return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetch(`/api/market/klines?symbol=${symbol}&tf=${tf}&limit=500`)
      .then((r) => r.json())
      .then((j: { ok: boolean; candles?: Candle[]; error?: string }) => {
        if (cancelled) return;
        if (j.ok && Array.isArray(j.candles)) setCandles(j.candles);
        else setLoadError(j.error ?? 'NO_DATA');
      })
      .catch(() => {
        if (!cancelled) setLoadError('NETWORK');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, symbol, tf]);

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
  const zone = coin ? zoneForRsi(coin.rsi) : null;
  const tvInterval = TF_TO_TV[tf];

  return (
    <AppShell>
      <main className="min-w-0 flex-1 space-y-3 p-3">
        <header className="card flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-[20px] font-bold text-white">
                {base}
                <span className="text-[13px] font-semibold text-text-muted">/USDT</span>
              </h1>
              <div className="mono-num mt-0.5 flex items-center gap-2 text-[11.5px]">
                <span className="select-all text-white">{coin ? formatPrice(coin.price) : '—'}</span>
                {coin ? (
                  <span className={coin.changePct24h >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                    {formatPct(coin.changePct24h)}
                  </span>
                ) : null}
                {coin && zone ? (
                  <Pill tone="gray" className="border-white/20">
                    RSI {formatRsi(coin.rsi)} · {zone.filterLabel}
                  </Pill>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={tf}
              onChange={(v) => {
                setTf(v);
                update('timeframe', v);
              }}
              options={TIMEFRAMES.map((t) => ({ value: t, label: t }))}
            />

            {/* §4.4  Mode A / Mode B toggle */}
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              <ModeButton
                active={mode === 'INTERNAL'}
                onClick={() => persistMode('INTERNAL')}
                icon="candles"
                label="Alpha X Native"
              />
              <ModeButton
                active={mode === 'EXTERNAL_TV'}
                onClick={() => persistMode('EXTERNAL_TV')}
                icon="chart"
                label="TradingView"
              />
            </div>

            <a href={tradingViewLink(base, tf)} target="_blank" rel="noopener noreferrer" className="btn-green whitespace-nowrap">
              Open in TradingView ↗
            </a>
            <a
              href={`https://www.binance.com/en/trade/${base}USDT?type=spot`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-amber whitespace-nowrap"
            >
              Binance Spot ↗
            </a>
          </div>
        </header>

        {/* Live metric strip */}
        {coin ? (
          <section className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="RSI(14)" value={formatRsi(coin.rsi)} tone={zone?.accent} />
            <Metric label="RVOL(20)" value={formatRvol(coin.rvol)} tone={coin.rvol >= 1.5 ? '#F5B301' : undefined} />
            <Metric label="ATR(14) %" value={`${coin.atrPct.toFixed(2)}%`} />
            <Metric label="Alpha Sniper" value={coin.alphaSniper.toFixed(1)} tone="#A78BFA" />
            <Metric
              label="Win rate (500)"
              value={coin.wr500 === null ? 'WARMING UP' : `${coin.wr500.toFixed(1)}%`}
              tone={coin.wr500 === null ? '#7E8FA6' : coin.wr500 >= 55 ? '#22C55E' : '#F87171'}
            />
            <Metric label="24h volume" value={`$${(coin.quoteVol24h / 1e6).toFixed(1)}M`} />
          </section>
        ) : null}

        {/* Chart surface */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <h2 className="text-[13px] font-bold text-white">
              BINANCE:{base}USDT · {tf}{' '}
              <span className="mono-num text-[10px] text-text-muted">
                interval={tvInterval} · {mode === 'INTERNAL' ? 'Mode A · Native Sniper' : 'Mode B · TradingView'}
              </span>
            </h2>
            <CopyButton value={`BINANCE:${base}USDT`} label="symbol" />
          </div>

          <div className="bg-black/40">
            {mode === 'INTERNAL' ? (
              loading && !candles.length ? (
                <div className="grid h-[620px] place-items-center text-[11px] text-text-muted">
                  Loading 500 candles for {symbol}…
                </div>
              ) : loadError && !candles.length ? (
                <div className="grid h-[620px] place-items-center px-6 text-center text-[11px] text-text-muted">
                  <div>
                    <p>
                      Candle history for {symbol} is not available yet ({loadError}).
                    </p>
                    <button
                      type="button"
                      onClick={() => persistMode('EXTERNAL_TV')}
                      className="btn-ghost mt-2"
                    >
                      Switch to TradingView ↗
                    </button>
                  </div>
                </div>
              ) : (
                <SniperChart candles={candles} symbol={symbol} height={460} />
              )
            ) : (
              <TradingViewAdvanced symbol={symbol} interval={tvInterval} height={620} />
            )}
          </div>

          <p className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-text-muted">
            {mode === 'INTERNAL'
              ? 'Rendered locally by Alpha X Scanner from live Binance klines. Candlestick colours are fixed: bullish emerald, bearish crimson.'
              : 'Charts are served by TradingView. '}
            {BRAND.productName} is an independent educational tool and is not affiliated with TradingView or Binance.
          </p>
        </section>

        {/* Pine scripts */}
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

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: 'candles' | 'chart';
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[10.5px] font-semibold transition-colors ${
        active ? 'bg-emerald-500/20 text-emerald-400' : 'text-text-secondary hover:bg-white/[0.05]'
      }`}
    >
      <Icon name={icon === 'chart' ? 'trending' : icon} size={13} />
      {label}
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-bg-card-2 px-2 py-1.5">
      <div className="text-[9.5px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mono-num text-[13px] font-bold" style={{ color: tone ?? '#FFFFFF' }}>
        {value}
      </div>
    </div>
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
