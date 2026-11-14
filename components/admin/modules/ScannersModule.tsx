'use client';

import { useEffect, useState } from 'react';

import { SCANNERS } from '@/lib/types';
import type { ScannerConfigRow, ScannerSlug, Timeframe } from '@/lib/types';
import { Btn, Card } from '../shared';
import { TIMEFRAME_OPTIONS } from '../types';

/**
 * MODULE 5  Scanner Math Tuner (Strategy Intelligence).
 *
 * Tweaks are saved per scanner and hot-reloaded into the running quant engine
 * — no server restart, no redeploy. Factory defaults are the institutional
 * parameter sets shipped with the product.
 */

const FACTORY_DEFAULTS: Record<ScannerSlug, Array<{ key: string; label: string; step: number }>> = {
  'v1-scaling': [
    { key: 'rsiMin', label: 'RSI Min', step: 0.5 },
    { key: 'rsiSweetMin', label: 'RSI Sweet Min', step: 0.5 },
    { key: 'rsiSweetMax', label: 'RSI Sweet Max', step: 0.5 },
    { key: 'rsiMax', label: 'RSI Max', step: 0.5 },
    { key: 'rvolMin', label: 'RVOL Min', step: 0.1 },
    { key: 'atrSlMult', label: 'ATR SL Multiplier', step: 0.1 },
    { key: 'atrTp1Mult', label: 'ATR TP1 Multiplier', step: 0.1 },
    { key: 'atrTp2Mult', label: 'ATR TP2 Multiplier', step: 0.1 },
  ],
  'order-block': [
    { key: 'minAtrWidth', label: 'Min Zone Span (ATR)', step: 0.05 },
    { key: 'maxAtrWidth', label: 'Max Zone Span (ATR)', step: 0.05 },
    { key: 'rejectionWickPct', label: 'Min Rejection Wick %', step: 5 },
    { key: 'rvolMin', label: 'RVOL Min', step: 0.1 },
    { key: 'maxTouches', label: 'Max Zone Touches', step: 1 },
    { key: 'lookbackSwing', label: 'Swing Lookback (bars)', step: 1 },
  ],
  'ema-crossover': [
    { key: 'fastEma', label: 'Fast EMA', step: 1 },
    { key: 'midEma', label: 'Mid EMA', step: 1 },
    { key: 'slowEma', label: 'Slow EMA', step: 1 },
    { key: 'pullbackAtrBand', label: 'Pullback ATR Band', step: 0.05 },
    { key: 'rvolMin', label: 'RVOL Min', step: 0.05 },
  ],
  'hidden-bullish': [
    { key: 'bullRsiMin', label: 'Bullish RSI Min', step: 1 },
    { key: 'bullRsiMax', label: 'Bullish RSI Max', step: 1 },
    { key: 'bearRsiMin', label: 'Bearish RSI Min', step: 1 },
    { key: 'bearRsiMax', label: 'Bearish RSI Max', step: 1 },
    { key: 'minSwingBars', label: 'Min Swing Bars', step: 1 },
    { key: 'maxSwingBars', label: 'Max Swing Bars', step: 1 },
    { key: 'rvolMin', label: 'RVOL Min', step: 0.1 },
  ],
  'alpha-sniper': [
    { key: 'rsiLength', label: 'RSI Length', step: 1 },
    { key: 'emaSmooth', label: 'EMA Smoothing', step: 1 },
    { key: 'lowerBand', label: 'Lower Band', step: 1 },
    { key: 'upperBand', label: 'Upper Band', step: 1 },
    { key: 'fastTrendEma', label: 'Fast Trend EMA', step: 1 },
    { key: 'slowTrendEma', label: 'Slow Trend EMA', step: 1 },
    { key: 'minWinRate500', label: 'Min 500-Candle Win Rate %', step: 0.5 },
    { key: 'minClosedTrades', label: 'Min Closed Trades', step: 1 },
  ],
};

/** Factory baseline — the exact institutional constants. */
export const FACTORY_VALUES: Record<string, number> = {
  rsiMin: 50,
  rsiSweetMin: 52,
  rsiSweetMax: 55,
  rsiMax: 58.5,
  rvolMinV1: 1.5,
  atrSlMult: 1.2,
  atrTp1Mult: 1.8,
  atrTp2Mult: 3.0,
  minAtrWidth: 0.15,
  maxAtrWidth: 1.6,
  rejectionWickPct: 45,
  rvolMinOB: 1.3,
  maxTouches: 1,
  lookbackSwing: 10,
  fastEma: 9,
  midEma: 21,
  slowEma: 50,
  pullbackAtrBand: 0.25,
  rvolMinEMA: 1.25,
  bullRsiMin: 30,
  bullRsiMax: 40,
  bearRsiMin: 60,
  bearRsiMax: 70,
  minSwingBars: 5,
  maxSwingBars: 40,
  rvolMinHB: 1.2,
  rsiLength: 14,
  emaSmooth: 3,
  lowerBand: 30,
  upperBand: 70,
  fastTrendEma: 13,
  slowTrendEma: 34,
  minWinRate500: 55.0,
  minClosedTrades: 5,
};

function factoryValue(slug: ScannerSlug, key: string): number | null {
  if (key === 'rvolMin') {
    const map: Record<ScannerSlug, number> = {
      'v1-scaling': 1.5,
      'order-block': 1.3,
      'ema-crossover': 1.25,
      'hidden-bullish': 1.2,
      'alpha-sniper': 1.2,
    };
    return map[slug];
  }
  return FACTORY_VALUES[key] ?? null;
}

type Draft = Record<string, number>;

export function ScannersModule({
  configs,
  reload,
  toast,
}: {
  configs: ScannerConfigRow[];
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [timeframes, setTimeframes] = useState<Record<string, Timeframe>>({});
  const [busy, setBusy] = useState<string | null>(null);

  /* Hydrate the drafts from server state whenever it reloads. */
  useEffect(() => {
    const d: Record<string, Draft> = {};
    const e: Record<string, boolean> = {};
    const t: Record<string, Timeframe> = {};
    for (const c of configs) {
      d[c.slug] = { ...c.parametersJson };
      e[c.slug] = c.enabled;
      t[c.slug] = c.defaultTimeframe;
    }
    setDrafts(d);
    setEnabled(e);
    setTimeframes(t);
  }, [configs]);

  const save = async (slug: ScannerSlug) => {
    setBusy(slug);
    try {
      const res = await fetch('/api/admin/scanner-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          parametersJson: drafts[slug] ?? {},
          enabled: enabled[slug] ?? true,
          defaultTimeframe: timeframes[slug] ?? '1H',
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast('Save failed — parameters were rejected.', 'warn');
        return;
      }
      toast(`${slug} parameters saved & hot-reloaded into the engine.`);
      await reload();
    } catch {
      toast('Network error — nothing saved.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const resetFactory = (slug: ScannerSlug) => {
    const next: Draft = {};
    for (const p of FACTORY_DEFAULTS[slug]) {
      const v = factoryValue(slug, p.key);
      if (v !== null) next[p.key] = v;
    }
    setDrafts((prev) => ({ ...prev, [slug]: next }));
    toast(`${slug} restored to factory institutional defaults — click Save to hot-reload.`);
  };

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {SCANNERS.map((s) => {
        const cfg = configs.find((c) => c.slug === s.slug);
        const params = drafts[s.slug] ?? {};
        const fields = FACTORY_DEFAULTS[s.slug];
        const isBusy = busy === s.slug;

        return (
          <Card
            key={s.slug}
            title={`${s.name} — ${s.slug}`}
            icon={s.slug === 'alpha-sniper' ? 'trending' : 'bolt'}
            subtitle={s.subtitle}
            className={s.slug === 'alpha-sniper' ? 'xl:col-span-2' : ''}
            actions={
              <>
                <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-text-secondary">
                  <input
                    type="checkbox"
                    checked={enabled[s.slug] ?? true}
                    onChange={(e) => setEnabled((prev) => ({ ...prev, [s.slug]: e.target.checked }))}
                    className="h-3 w-3 accent-emerald-500"
                  />
                  Enabled
                </label>
                <select
                  value={timeframes[s.slug] ?? '1H'}
                  onChange={(e) => setTimeframes((prev) => ({ ...prev, [s.slug]: e.target.value as Timeframe }))}
                  className="rounded border border-white/10 bg-bg-card-2 px-1 py-0.5 text-[10px] text-text-secondary"
                  title="Default timeframe"
                >
                  {TIMEFRAME_OPTIONS.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </>
            }
          >
            <div className="space-y-2 p-3">
              <div
                className={`grid gap-2 ${
                  fields.length > 6 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3'
                }`}
              >
                {fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">{f.label}</span>
                    <input
                      type="number"
                      step={f.step}
                      value={String(params[f.key] ?? '')}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [s.slug]: { ...(prev[s.slug] ?? {}), [f.key]: Number(e.target.value) },
                        }))
                      }
                      className="input mono-num h-7 w-full"
                    />
                  </label>
                ))}
              </div>

              {cfg ? (
                <p className="text-[9.5px] text-text-muted">
                  Last saved <span className="mono-num">{new Date(cfg.updatedAt).toLocaleString()}</span> · currently{' '}
                  <span className={cfg.enabled ? 'text-emerald-400' : 'text-red-400'}>{cfg.enabled ? 'ACTIVE' : 'DISABLED'}</span>
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-2.5">
                <Btn tone="green" icon="bolt" busy={isBusy} onClick={() => void save(s.slug)}>
                  💾 Save &amp; Hot-Reload
                </Btn>
                <Btn icon="reset" onClick={() => resetFactory(s.slug)}>
                  ↺ Reset to Factory
                </Btn>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
