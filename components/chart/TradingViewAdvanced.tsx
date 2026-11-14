'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * §4.4  MODE B — TradingView Advanced Real-Time Widget.
 *
 * Loads the official widget from `https://s3.tradingview.com/tv.js` once per
 * page and binds it to `BINANCE:<symbol>` in the user's selected timeframe.
 * Dark theme (#0A0C14), full drawing toolbar and indicators enabled.
 *
 * The script is injected imperatively (not via next/script) because the widget
 * must be constructed after the container exists and re-constructed whenever
 * the symbol or interval changes.
 */

const TV_SCRIPT = 'https://s3.tradingview.com/tv.js';
const BG = '#0A0C14';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TradingView?: any;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTvScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('no window'));
      return;
    }
    if (window.TradingView) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TV_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('tv.js failed')));
      return;
    }
    const el = document.createElement('script');
    el.src = TV_SCRIPT;
    el.async = true;
    el.type = 'text/javascript';
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('tv.js failed'));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export interface TradingViewAdvancedProps {
  symbol: string;
  /** TradingView interval codes: 15 / 30 / 60 / 240 / D */
  interval: string;
  height?: number;
}

export function TradingViewAdvanced({ symbol, interval, height = 620 }: TradingViewAdvancedProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    loadTvScript()
      .then(() => {
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = '';
        const w = window;
        if (!w.TradingView?.widget) {
          setFailed(true);
          return;
        }
        // eslint-disable-next-line no-new
        new w.TradingView.widget({
          autosize: false,
          width: '100%',
          height,
          symbol: `BINANCE:${symbol}`,
          interval,
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          backgroundColor: BG,
          gridColor: 'rgba(255,255,255,0.05)',
          /* §4.4  Full drawing toolbar and indicators enabled. */
          toolbar_bg: BG,
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          save_image: true,
          details: true,
          hotlist: true,
          calendar: true,
          news: ['headlines'],
          studies: [],
          show_popup_button: false,
          withdateranges: true,
          container_id: hostRef.current.id,
        });
        setFailed(false);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
    };
  }, [symbol, interval, height, setFailed]);

  return (
    <div style={{ height }}>
      <div
        id={`tv-advanced-${symbol.replace(/[^A-Z0-9]/gi, '')}`}
        ref={hostRef}
        className="h-full w-full"
        aria-label={`TradingView advanced chart for ${symbol}`}
      />
      {failed ? (
        <p className="px-3 py-2 text-[10.5px] text-text-muted">
          The TradingView widget could not load (network or ad-blocker). Switch to{' '}
          <span className="font-semibold text-emerald-400">Alpha X Native</span> for the same data rendered locally.
        </p>
      ) : null}
    </div>
  );
}
