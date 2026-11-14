'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ZONES, zoneForRsi, type CoinSnapshot, type MarketFrame, type Timeframe, type ZoneId } from '@/lib/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import { HeatmapHeader } from './HeatmapHeader';
import { DENSITY } from '@/lib/constants';
import { CoinTile, heatmapKeyNav } from './CoinTile';
import { VirtualGrid } from '@/components/ui/VirtualGrid';

/**
 * §6.3  Mode A — the six RSI Heatmap zones.
 * Coins are grouped into six vertical sections and sorted by RSI descending
 * inside each section.
 */
export function HeatmapView({
  frame,
  countdown,
  timeframe,
  enableZoneFilters = true,
}: {
  frame: MarketFrame | null;
  countdown: number;
  timeframe: Timeframe;
  enableZoneFilters?: boolean;
}) {
  const { settings } = useSettings();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeZones, setActiveZones] = useState<Set<ZoneId>>(new Set());
  const [spotlightSymbol, setSpotlightSymbol] = useState<string | null>(null);

  const openCoin = useCallback(
    (coin: CoinSnapshot, tf: Timeframe) => {
      if (settings.chartMode === 'INTERNAL') {
        router.push(`/chart/${coin.baseAsset}?tf=${tf}`);
        return;
      }
      window.open(
        `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.baseAsset}USDT&interval=${TF_TOKEN[tf]}`,
        '_blank',
        'noopener,noreferrer',
      );
    },
    [router, settings.chartMode],
  );

  const grouped = useMemo(() => {
    const map = new Map<ZoneId, CoinSnapshot[]>();
    for (const z of ZONES) map.set(z.id, []);
    for (const c of frame?.coins ?? []) {
      if (settings.hideMonitoring && c.isMonitoringTag) continue;
      map.get(zoneForRsi(c.rsi).id)?.push(c);
    }
    for (const [, list] of map) list.sort((a, b) => b.rsi - a.rsi);
    return map;
  }, [frame, settings.hideMonitoring]);

  const toggleZone = useCallback((id: ZoneId) => {
    setActiveZones((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const jumpToSpotlight = useCallback(() => {
    const symbol = frame?.spotlight?.symbol;
    if (!symbol) return;
    setSpotlightSymbol(symbol);
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-tile="${symbol}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, [frame?.spotlight?.symbol]);

  const visibleZones = enableZoneFilters && activeZones.size > 0 ? ZONES.filter((z) => activeZones.has(z.id)) : ZONES;

  if (!frame) {
    return (
      <div className="space-y-3">
        <div className="h-[70px] animate-pulse rounded-xl border border-white/[0.06] bg-bg-card/60" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-1.5">
          {Array.from({ length: 96 }).map((_, i) => (
            <div key={i} className="h-[36px] animate-pulse rounded-[6px] bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HeatmapHeader
        frame={frame}
        countdown={countdown}
        activeZones={activeZones}
        onToggleZone={toggleZone}
        onJumpToSpotlight={jumpToSpotlight}
      />

      <div
        ref={containerRef}
        className="space-y-3"
        onKeyDown={(e) => heatmapKeyNav(e, containerRef.current)}
        aria-label={`RSI Heatmap, ${frame.coins.length} coins, ${timeframe} timeframe`}
      >
        {visibleZones.map((zone) => {
          const coins = grouped.get(zone.id) ?? [];
          if (coins.length === 0) return null;
          return (
            <section key={zone.id} className="space-y-2 pl-3" style={{ borderLeft: `3px solid ${zone.accent}` }}>
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-[13.5px] font-bold text-white">
                  <span aria-hidden="true">{zone.emoji}</span> {zone.title}
                </h2>
                <span className="mono-num text-[11px] text-text-muted">{coins.length} coins</span>
              </div>
              {/* §5.3  Windowed virtualisation — only the rows intersecting the
                  viewport are mounted, so a 300-coin zone costs ~30 tiles. */}
              <VirtualGrid
                items={coins}
                keyOf={(c) => c.symbol}
                tileWidth={DENSITY[settings.density].tileW}
                tileHeight={DENSITY[settings.density].tileH}
                gap={6}
                remeasureKey={`${settings.density}-${zone.id}-${coins.length}`}
                renderItem={(coin) => (
                  <CoinTile
                    coin={coin}
                    zone={zone}
                    timeframe={timeframe}
                    density={settings.density}
                    onOpen={openCoin}
                    highlighted={spotlightSymbol === coin.symbol}
                  />
                )}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}

const TF_TOKEN: Record<Timeframe, string> = { '15M': '15', '30M': '30', '1H': '60', '4H': '240', '1D': 'D' };
