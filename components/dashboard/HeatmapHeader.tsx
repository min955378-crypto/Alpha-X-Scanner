'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { formatClock, formatCountdown } from '@/lib/format';
import { BRAND } from '@/lib/constants';
import { ZONES, type MarketFrame, type Timeframe, type ZoneId } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { useSettings } from '@/components/providers/SettingsProvider';
import { Icon } from '@/components/ui/Icons';

/**
 * §6.1  Three-part top header strip:
 *   1. brand watermark box (118×50)
 *   2. RSI Heatmap header (LIVE badge · Updated time · density toggle ·
 *      6 zone filter pills · countdown · RSI 52-55 Rising spotlight)
 *   3. Overall Market Sentiment box (195×54)
 */
export function HeatmapHeader({
  frame,
  countdown,
  activeZones,
  onToggleZone,
  onJumpToSpotlight,
}: {
  frame: MarketFrame | null;
  countdown: number;
  activeZones: Set<ZoneId>;
  onToggleZone: (id: ZoneId) => void;
  onJumpToSpotlight: () => void;
}) {
  const { settings, update } = useSettings();

  const updated = frame ? formatClock(new Date(frame.t), settings.timezone, settings.clock24) : '—';
  const sentiment = frame?.sentiment;
  const sentimentTone =
    sentiment?.label === 'BULLISH'
      ? 'text-emerald-400'
      : sentiment?.label === 'BEARISH'
        ? 'text-red-400'
        : 'text-gray-200';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-bg-card/90 p-2.5">
      {/* 1 — Brand watermark */}
      <div
        className="flex h-[50px] w-[118px] shrink-0 items-center justify-center rounded-lg border border-cyan-500/40 bg-gradient-to-br from-cyan-950/60 to-blue-950/40 text-center text-[11px] font-semibold text-white"
        title={BRAND.promoHeadline}
      >
        {BRAND.brandWatermark}
      </div>

      {/* 2 — Heatmap header */}
      <div className="min-w-[280px] flex-1 space-y-1.5 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[14px] font-bold text-white"><Icon name="layers" size={15} className="text-emerald-400" /> RSI Heatmap</span>
          <span className="flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
            LIVE
          </span>
          <span className="mono-num text-[11px] text-text-secondary">Updated: {updated}</span>
          <Segmented
            options={[
              { value: 'COMPACT', label: 'Compact', title: '66×28px tiles — video replica' },
              { value: 'COMFORTABLE', label: 'Comfortable', title: '86×36px tiles — default' },
            ]}
            value={settings.density}
            onChange={(v) => update('density', v)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px]">
          {ZONES.map((z) => {
            const active = activeZones.has(z.id);
            return (
              <button
                key={z.id}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleZone(z.id)}
                style={{ borderColor: z.accent, color: active ? '#fff' : z.accent }}
                className={`rounded-full border px-2 py-0.5 font-semibold transition-all ${
                  active ? 'bg-white/15' : 'bg-white/[0.04] opacity-70 hover:opacity-100'
                }`}
              >
                {z.filterLabel}
              </button>
            );
          })}
        </div>

        <div className="mono-num flex flex-wrap items-center justify-center gap-3 text-[11px] text-text-secondary">
          <span>
            Next update in:{' '}
            <strong className="text-white">{formatCountdown(countdown)}</strong>
          </span>
          {frame?.spotlight ? (
            <button
              type="button"
              onClick={onJumpToSpotlight}
              className="laser-border relative inline-flex items-center gap-1 rounded border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-orange-300 hover:border-orange-400"
              style={{ '--laser-color': '#F97316' } as CSSProperties}
              title="Highlight and scroll to this coin"
            >
              <Icon name="spark" size={12} />
              <span>RSI 52-55 Rising:</span>{' '}
              <strong className="text-white">{frame.spotlight.baseAsset}</strong>
              <span className="mono-num">RSI {frame.spotlight.rsi.toFixed(1)}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-text-muted">
              <Icon name="spark" size={12} />
              RSI 52-55 Rising: scanning…
            </span>
          )}
        </div>
      </div>

      {/* 3 — Sentiment */}
      <div className="flex h-[54px] w-[195px] shrink-0 flex-col items-center justify-center rounded-lg border border-white/10 bg-bg-card-2">
        <div className={`text-[14px] font-extrabold ${sentimentTone}`}>
          {sentiment ? `${sentiment.glyph} ${sentiment.label}` : '→ NEUTRAL'}
        </div>
        <div className="mono-num text-[10px] text-text-secondary">
          {sentiment ? `${sentiment.risingPct}% rising · ${sentiment.fallingPct}% falling (24h)` : '—'}
        </div>
      </div>
    </div>
  );
}

/**
 * 1 Hz clock. Returns `null` until mounted so server and client markup always
 * agree on first paint.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
