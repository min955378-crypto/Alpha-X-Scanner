'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { readStore, writeStore, migrateV1ToV2, type StorageKey } from '@/lib/storage';
import type { Timeframe } from '@/lib/types';

export interface Settings {
  timeframe: Timeframe;
  density: 'COMPACT' | 'COMFORTABLE';
  clock24: boolean;
  timezone: string;
  language: 'BILINGUAL' | 'ENGLISH_ONLY';
  chartMode: 'EXTERNAL_TV' | 'INTERNAL';
  soundEnabled: boolean;
  alertVolume: number;
  hideMonitoring: boolean;
  volumeFormat: 'ABBREVIATED' | 'FULL';
  pricePrecision: 'AUTO' | number;
  watchlist: string[];
  presets: SavedPreset[];
  activeView: 'HEATMAP' | 'PRO_TABLE' | 'COIN_FINDER' | 'WATCHLIST';
}

export interface SavedPreset {
  id: string;
  name: string;
  savedAt: number;
  filters: Record<string, unknown>;
}

const DEFAULTS: Settings = {
  timeframe: '1H',
  density: 'COMFORTABLE',
  clock24: false,
  timezone: 'Asia/Karachi',
  language: 'BILINGUAL',
  chartMode: 'EXTERNAL_TV',
  soundEnabled: false,
  alertVolume: 60,
  hideMonitoring: false,
  volumeFormat: 'ABBREVIATED',
  pricePrecision: 'AUTO',
  watchlist: [],
  presets: [],
  activeView: 'HEATMAP',
};

interface SettingsApi {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  toggleWatch: (symbol: string) => void;
  isWatched: (symbol: string) => boolean;
  savePreset: (name: string, filters: Record<string, unknown>) => void;
  deletePreset: (id: string) => void;
  hydrated: boolean;
}

const Ctx = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: Partial<Settings> }) {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULTS, ...initial });
  const [hydrated, setHydrated] = useState(false);

  // §11.2  One-time idempotent v1 -> v2 migrator, then hydrate.
  useEffect(() => {
    migrateV1ToV2();
    setSettings((prev) => ({
      ...prev,
      timeframe: readStore('timeframe', prev.timeframe),
      density: readStore('density', prev.density),
      clock24: readStore('clock24', prev.clock24),
      timezone: readStore('timezone', prev.timezone),
      language: readStore('language', prev.language),
      chartMode: readStore('chartMode', prev.chartMode),
      soundEnabled: readStore('sound', prev.soundEnabled),
      alertVolume: readStore('alertVolume', prev.alertVolume),
      hideMonitoring: readStore('hideMonitoring', prev.hideMonitoring),
      volumeFormat: readStore('volumeFormat', prev.volumeFormat),
      pricePrecision: readStore('pricePrecision', prev.pricePrecision),
      watchlist: readStore('watchlist', prev.watchlist),
      presets: readStore('presets', prev.presets),
      activeView: readStore('activeView', prev.activeView),
    }));
    setHydrated(true);
  }, []);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      writeStore(key as StorageKey, value);
      return next;
    });
  }, []);

  const toggleWatch = useCallback((symbol: string) => {
    setSettings((prev) => {
      const has = prev.watchlist.includes(symbol);
      const watchlist = has ? prev.watchlist.filter((s) => s !== symbol) : [...prev.watchlist, symbol];
      writeStore('watchlist', watchlist);
      return { ...prev, watchlist };
    });
  }, []);

  const isWatched = useCallback((symbol: string) => settings.watchlist.includes(symbol), [settings.watchlist]);

  const savePreset = useCallback((name: string, filters: Record<string, unknown>) => {
    setSettings((prev) => {
      const presets = [...prev.presets.filter((p) => p.name !== name), { id: `${Date.now()}`, name, savedAt: Date.now(), filters }];
      writeStore('presets', presets);
      return { ...prev, presets };
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setSettings((prev) => {
      const presets = prev.presets.filter((p) => p.id !== id);
      writeStore('presets', presets);
      return { ...prev, presets };
    });
  }, []);

  const value = useMemo(
    () => ({ settings, update, toggleWatch, isWatched, savePreset, deletePreset, hydrated }),
    [settings, update, toggleWatch, isWatched, savePreset, deletePreset, hydrated],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
