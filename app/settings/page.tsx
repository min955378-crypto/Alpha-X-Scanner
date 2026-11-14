'use client';

import { useRef, useState } from 'react';

import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { formatClock } from '@/lib/format';
import { exportBackup, importBackup } from '@/lib/storage';
import { AppShell } from '@/components/shell/AppShell';
import { Segmented, Toggle } from '@/components/ui';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useMarket } from '@/components/providers/MarketProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { playChime } from '@/components/scanners/ScannerView';

/**
 * §11.2  User settings: display & density, timezone & clock, chart & scanner
 * defaults, plus watchlist/preset backup and the v1 → v2 migrator.
 */
export default function SettingsPage() {
  const { settings, update, hydrated } = useSettings();
  const { setTimeframe } = useMarket();
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [now] = useState<Date | null>(null);

  const saveToServer = async (patch: Record<string, unknown>) => {
    await fetch('/api/user/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  };

  return (
    <AppShell>
      <main className="min-w-0 flex-1 space-y-3 p-3">
        <header className="card p-3">
          <h1 className="text-[18px] font-bold text-white">⚙ Settings</h1>
          <p className="mt-1 text-[11.5px] text-text-secondary">
            Preferences are stored locally under <code className="mono-num text-amber-300">scalppro:v2:*</code> and the
            cross-device subset syncs to your user profile.
          </p>
        </header>

        <div className="grid gap-3 xl:grid-cols-2">
          {/* 1 — Display & density */}
          <Section title="🖥 Display & Density Preferences">
            <Row label="Heatmap tile density">
              <Segmented
                value={settings.density}
                onChange={(v) => update('density', v)}
                options={[
                  { value: 'COMFORTABLE', label: 'Comfortable (86×36px)', title: 'Default — accurate thumb tapping' },
                  { value: 'COMPACT', label: 'Compact (66×28px)', title: 'Video replica' },
                ]}
              />
            </Row>
            <Row label="Volume formatting">
              <Segmented
                value={settings.volumeFormat}
                onChange={(v) => update('volumeFormat', v)}
                options={[
                  { value: 'ABBREVIATED', label: 'Abbreviated ($1.84B)' },
                  { value: 'FULL', label: 'Full numeric' },
                ]}
              />
            </Row>
            <Row label="Price precision">
              <Segmented
                value={String(settings.pricePrecision)}
                onChange={(v) => update('pricePrecision', v === 'AUTO' ? 'AUTO' : Number(v))}
                options={[
                  { value: 'AUTO', label: 'Auto by magnitude' },
                  { value: '2', label: '2 dp' },
                  { value: '4', label: '4 dp' },
                  { value: '6', label: '6 dp' },
                ]}
              />
            </Row>
          </Section>

          {/* 2 — Timezone & clock */}
          <Section title="🕒 Timezone & Clock Settings">
            <Row label="Active timezone">
              <Segmented
                value={settings.timezone}
                onChange={(v) => {
                  update('timezone', v);
                  void saveToServer({ timezonePref: v });
                }}
                options={[
                  { value: 'Asia/Karachi', label: 'Local (PKT)' },
                  { value: 'UTC', label: 'UTC' },
                  { value: 'America/New_York', label: 'New York' },
                ]}
              />
            </Row>
            <Row label="Clock format">
              <Segmented
                value={settings.clock24 ? '24' : '12'}
                onChange={(v) => update('clock24', v === '24')}
                options={[
                  { value: '12', label: '12-hour (09:52:59 PM)' },
                  { value: '24', label: '24-hour (21:52:59)' },
                ]}
              />
            </Row>
            <Row label="Language mode">
              <Segmented
                value={settings.language}
                onChange={(v) => update('language', v)}
                options={[
                  { value: 'BILINGUAL', label: 'EN + اردو' },
                  { value: 'ENGLISH_ONLY', label: 'English only' },
                ]}
              />
            </Row>
            <div className="mono-num rounded bg-white/[0.03] px-2 py-1.5 text-[11px] text-text-secondary">
              Live clock preview: {now ? formatClock(now, settings.timezone, settings.clock24) : '—'}
            </div>
          </Section>

          {/* 3 — Chart & scanner defaults */}
          <Section title="📈 Chart & Scanner Defaults">
            <Row label="Default timeframe">
              <Segmented
                value={settings.timeframe}
                onChange={(v) => {
                  update('timeframe', v as Timeframe);
                  setTimeframe(v as Timeframe);
                  void saveToServer({ preferredTimeframe: v });
                }}
                options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
              />
            </Row>
            <Row label="Coin tile click behavior">
              <Segmented
                value={settings.chartMode}
                onChange={(v) => {
                  update('chartMode', v);
                  void saveToServer({ chartMode: v });
                }}
                options={[
                  { value: 'EXTERNAL_TV', label: 'External TradingView' },
                  { value: 'INTERNAL', label: 'Internal /chart/:symbol' },
                ]}
              />
            </Row>
            <Toggle
              id="sound"
              checked={settings.soundEnabled}
              onChange={(v) => {
                update('soundEnabled', v);
                void saveToServer({ soundEnabled: v });
              }}
              label="🔊 Audio alert chime"
            />
            {settings.soundEnabled ? (
              <div>
                <div className="mb-1 flex justify-between text-[10.5px] text-text-secondary">
                  <span>Chime volume</span>
                  <span className="mono-num">{settings.alertVolume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={settings.alertVolume}
                  onChange={(e) => update('alertVolume', Number(e.target.value))}
                  className="h-1 w-full accent-amber-500"
                  aria-label="Chime volume"
                />
                <button type="button" onClick={() => playChime(settings.alertVolume)} className="btn-ghost mt-1.5 w-full">
                  🔊 Test Chime
                </button>
              </div>
            ) : null}
            <Toggle
              id="hide-monitoring"
              checked={settings.hideMonitoring}
              onChange={(v) => update('hideMonitoring', v)}
              label="Hide ⚠ Monitoring Tag coins in scanners"
            />
          </Section>

          {/* 4 — Backup & migration */}
          <Section title="💾 Watchlist & Preset Backup">
            <p className="text-[11px] leading-relaxed text-text-secondary">
              The <code className="mono-num">scalppro:v1:*</code> → <code className="mono-num">scalppro:v2:*</code>{' '}
              migrator runs automatically on startup, so v1 watchlists, timeframes, sounds, presets and disclaimer
              acknowledgements carry over with zero data loss.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([exportBackup()], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `scalppro-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="btn-ghost"
              >
                ⭳ Export Watchlist &amp; Presets (.json)
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost">
                ⭱ Import Backup (.json)
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const n = importBackup(await file.text());
                    push({ title: 'Backup imported', body: `${n} keys restored — reloading…`, level: 'success' });
                    setTimeout(() => window.location.reload(), 900);
                  } catch {
                    push({ title: 'Import failed', body: 'That file is not a ScalpPro backup.', level: 'error' });
                  }
                }}
              />
            </div>
            <div className="mono-num rounded bg-white/[0.03] px-2 py-1.5 text-[11px] text-text-secondary">
              Watchlist: {settings.watchlist.length} symbols · Presets: {settings.presets.length} · Storage hydrated:{' '}
              {hydrated ? 'yes' : 'no'}
            </div>
          </Section>
        </div>
      </main>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-2.5 p-3">
      <h2 className="text-[13px] font-bold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11.5px] text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
