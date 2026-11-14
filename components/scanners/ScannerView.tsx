'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { formatClock, formatRsi, formatRvol, levelCopyValue } from '@/lib/format';
import { type ScannerMeta, type ScannerSignal, type SignalDirection, type SignalStage } from '@/lib/types';
import { useMarket } from '@/components/providers/MarketProvider';
import { useOpenSymbolChart } from '@/components/chart/ChartDrawer';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { licenseStatus } from '@/lib/license';
import { CopyableValue, Pill, ScoreMeter, Toggle } from '@/components/ui';
import { Icon } from '@/components/ui/Icons';
import { TiltCard } from '@/components/ui/Motion3D';
import { useToast } from '@/components/providers/ToastProvider';

/**
 * §7.1  Shared 2-column scanner template used by all five scanners.
 *   Left  — header card + controls + progress strip + Signals panel
 *   Right — Settings · Signal Guide · Logs · Waiting/BUY queue (300px)
 */

type DirectionFilter = 'ALL' | 'LONG' | 'SHORT';

const STAGE_TONE: Record<SignalStage, 'green' | 'amber' | 'blue' | 'gray'> = {
  ENTRY_READY: 'green',
  WAITING: 'amber',
  POTENTIAL: 'blue',
  EXPIRED: 'gray',
  INVALIDATED: 'gray',
};

export function ScannerView({ meta }: { meta: ScannerMeta }) {
  const openSymbol = useOpenSymbolChart();
  const { signals, scanNow, lastScanAt, timeframe } = useMarket();
  const { settings, update } = useSettings();
  const { user } = useAuth();
  const { push } = useToast();

  const [running, setRunning] = useState(false);
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [logs, setLogs] = useState<Array<{ t: number; line: string }>>([]);
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);

  /* §2.1  A padlock screen never renders again — an active license key unlocks
     every scanner. `licenceActive` only tracks license STATUS (expired /
     revoked / suspended), which is the sole remaining gate. */
  const entitled = Boolean(user?.entitlements[meta.entitlementKey]);
  const licenceActive = licenseStatus(user).active;
  const list = signals[meta.slug] ?? [];

  const filtered = useMemo(
    () => (direction === 'ALL' ? list : list.filter((s) => s.direction === direction)),
    [list, direction],
  );

  const waiting = useMemo(() => list.filter((s) => s.stage === 'WAITING' || s.stage === 'ENTRY_READY'), [list]);

  /* §7.1  [▶ Start] subscribes the session to the scanner channel and unlocks
     the WebAudio context — it never triggers per-user Binance calls. */
  const start = useCallback(() => {
    setRunning(true);
    if (typeof window !== 'undefined') window.sessionStorage.setItem(`alphax:v2:scanner:${meta.slug}`, 'running');
    if (settings.soundEnabled && typeof window !== 'undefined') {
      try {
        audioRef.current = audioRef.current ?? new AudioContext();
        void audioRef.current.resume();
      } catch {
        /* autoplay policy — chime will engage on first user gesture */
      }
    }
    log(`${meta.name} started · subscribed to ${timeframe} scan cycle`);
    void scanNow(meta.slug).then((s) => log(`scan complete · ${s.length} setups`));
  }, [meta.name, meta.slug, scanNow, settings.soundEnabled, timeframe, log]);

  const stop = useCallback(() => {
    setRunning(false);
    if (typeof window !== 'undefined') window.sessionStorage.setItem(`alphax:v2:scanner:${meta.slug}`, 'idle');
    log(`■ ${meta.name} stopped`);
  }, [meta.name, meta.slug, log]);

  const reset = useCallback(() => {
    setLogs([]);
    setProgress(0);
    log(`↺ ${meta.name} reset`);
  }, [meta.name, log]);

  const manualScan = useCallback(async () => {
    if (!licenceActive) {
      push({
        title: 'License inactive',
        body: 'Your license key has expired or been revoked. Renew to resume live scanning.',
        level: 'warn',
      });
      return;
    }
    setScanning(true);
    setProgress(8);
    const step = setInterval(() => setProgress((p) => Math.min(92, p + 12)), 90);
    const result = await scanNow(meta.slug);
    clearInterval(step);
    setProgress(100);
    setTimeout(() => setProgress(0), 700);
    setScanning(false);
    log(`manual scan · ${result.length} setups · ${result.filter((s) => s.stage === 'ENTRY_READY').length} entry-ready`);
    if (settings.soundEnabled && result.some((s) => s.stage === 'ENTRY_READY')) playChime(settings.alertVolume);
  }, [entitled, meta.slug, push, scanNow, settings.alertVolume, settings.soundEnabled, log]);

  function log(line: string) {
    setLogs((prev) => [...prev.slice(-199), { t: Date.now(), line }]);
  }

  // Reflect live scanner cycles into the log while running.
  useEffect(() => {
    if (!running) return;
    const at = lastScanAt[meta.slug];
    if (!at) return;
    log(`cycle update · ${list.length} setups · ${list.filter((s) => s.stage === 'ENTRY_READY').length} entry-ready`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastScanAt, running, meta.slug]);

  useEffect(() => {
    if (running) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      {/* ------------------------ LEFT COLUMN ------------------------ */}
      <div className="min-w-0 space-y-3">
        <header className="card overflow-hidden" style={{ borderLeft: `3px solid ${meta.accent}` }}>
          <div className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9.5px] font-bold text-text-secondary">
                {meta.tfLabel} · {meta.category}
              </span>
              <span className="text-[16px] font-bold text-white">
                <span aria-hidden="true">{meta.emoji}</span> {meta.name}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-text-secondary">{meta.subtitle}</p>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button type="button" onClick={start} disabled={running} className="btn-green disabled:opacity-40">
                <Icon name="play" size={13} /> Start
              </button>
              <button type="button" onClick={stop} disabled={!running} className="btn-red disabled:opacity-40">
                <Icon name="pause" size={13} /> Stop
              </button>
              <button type="button" onClick={reset} className="btn-ghost">
                <Icon name="reset" size={13} /> Reset
              </button>
              <button type="button" onClick={manualScan} disabled={scanning} className="btn-blue disabled:opacity-40">
                <Icon name="scan" size={13} /> Scan Now
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-white/[0.06] bg-bg-card-2/60 px-3 py-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${running ? 100 : progress}%`, opacity: running ? 0.5 : 1 }}
              />
            </div>
            <span className="mono-num text-[10px] text-text-muted">
              Last: {lastScanAt[meta.slug] ? formatClock(new Date(lastScanAt[meta.slug]!), settings.timezone, settings.clock24) : '—'}
            </span>
            <button type="button" onClick={manualScan} className="btn-ghost px-1.5 py-0.5 text-[10px]">
              <Icon name="scan" size={13} /> Scan Now
            </button>
          </div>
        </header>

        {/* -------------------------- SIGNALS -------------------------- */}
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] p-2.5">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-white"><Icon name="activity" size={14} /> Signals</h2>
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                {filtered.length}
              </span>
              <span className="mono-num text-[10px] text-text-muted">
                Last scan: {lastScanAt[meta.slug] ? formatClock(new Date(lastScanAt[meta.slug]!), settings.timezone, settings.clock24) : '—'}
              </span>
            </div>
            <div className="flex gap-1">
              {(['ALL', 'LONG', 'SHORT'] as DirectionFilter[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => setDirection(d)}
                  className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                    direction === d
                      ? d === 'LONG'
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                        : d === 'SHORT'
                          ? 'border-red-500/60 bg-red-500/15 text-red-300'
                          : 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-white/10 bg-white/[0.03] text-text-secondary hover:text-white'
                  }`}
                >
                  {d === 'ALL' ? 'All' : d === 'LONG' ? '▲ Long' : '▼ Short'}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[62vh] space-y-2 overflow-y-auto p-2.5">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-text-muted">No signals yet — press Start to scan</p>
            ) : (
              filtered.map((s) => <SignalCard key={s.id} signal={s} onOpen={() => openSymbol(s.symbol, s.timeframe)} />)
            )}
          </div>
        </section>
      </div>

      {/* ------------------------ RIGHT COLUMN ------------------------ */}
      <aside className="w-full space-y-3 xl:w-[300px]">
        <div className="card space-y-2 p-2.5">
          <h3 className="flex items-center gap-1.5 text-[12px] font-bold text-white"><Icon name="settings" size={13} /> Settings</h3>
          <Toggle
            id="scanner-sound"
            checked={settings.soundEnabled}
            onChange={(v) => update('soundEnabled', v)}
            label="🔊 Sound"
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
          <button
            type="button"
            onClick={async () => {
              await fetch('/api/user/settings', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ soundEnabled: settings.soundEnabled }),
              });
              push({ title: 'Settings saved', level: 'success' });
            }}
            className="w-full rounded-md bg-white px-3 py-1.5 text-[11.5px] font-bold text-black hover:bg-gray-200"
          >
            💾 Save
          </button>
        </div>

        {/* §7.1  Signal Guide — [SEEN IN VIDEO] */}
        <div className="card p-2.5">
          <h3 className="mb-2 text-[12px] font-bold text-white">📘 Signal Guide</h3>
          <ul className="space-y-1 text-[11px] text-text-secondary">
            <li>• Potential setups pass structure screening</li>
            <li>• Waiting: entry confirmation is pending</li>
            <li>• BUY: entry conditions are currently satisfied</li>
            <li>• Live setups can change as the market moves</li>
          </ul>
        </div>

        <div className="card p-2.5">
          <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-white"><Icon name="book" size={13} /> Logs</h3>
          <div className="mono-num max-h-[180px] space-y-0.5 overflow-y-auto text-[10px] leading-relaxed text-text-secondary">
            {logs.length === 0 ? <div>No log entries yet</div> : null}
            {logs.map((l, i) => (
              <div key={`${l.t}-${i}`} className="select-text">
                <span className="text-text-muted">{formatClock(new Date(l.t), settings.timezone, true)}</span> {l.line}
              </div>
            ))}
          </div>
        </div>

        <div className="card p-2.5">
          <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-white"><Icon name="clock" size={13} /> Waiting / BUY Coins</h3>
          {waiting.length === 0 ? (
            <p className="text-[11px] text-text-muted">No active coins</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {waiting.map((s) => (
                <span
                  key={s.id}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    s.stage === 'ENTRY_READY'
                      ? s.direction === 'LONG'
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                        : 'border-red-500/60 bg-red-500/15 text-red-300'
                      : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {s.baseAsset} {s.stage === 'ENTRY_READY' ? (s.direction === 'LONG' ? 'BUY' : 'SHORT') : 'WAIT'}
                </span>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SignalCard({ signal, onOpen }: { signal: ScannerSignal; onOpen: () => void }) {
  const badge =
    signal.stage === 'ENTRY_READY' ? (signal.direction === 'LONG' ? 'BUY' : 'SHORT') : signal.stage;

  /* §Phase 2 §2.4 — rotating conic laser border on every BUY / SHORT entry. */
  const entryReady = signal.stage === 'ENTRY_READY';
  const laser = entryReady ? (signal.direction === 'LONG' ? '#00D26A' : '#FF3B5C') : null;

  return (
    <TiltCard max={5} className="rounded-lg">
      <article
        className={`relative rounded-lg border border-white/[0.07] bg-bg-card-2 p-2.5 ${
          laser ? 'laser-border' : ''
        }`}
        style={laser ? ({ '--laser-color': laser } as CSSProperties) : undefined}
      >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StageBadge stage={signal.stage} direction={signal.direction} label={badge} />
          <a
            href={`/chart/${signal.baseAsset}?tf=${signal.timeframe}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onOpen();
            }}
            className="select-all text-[13px] font-bold text-white hover:underline"
          >
            {signal.baseAsset}
          </a>
          {signal.isMonitoringTag ? (
            <Pill tone="amber" title="Binance Monitoring Tag — 25-point score penalty applied">
              ⚠ Monitoring Tag Risk
            </Pill>
          ) : null}
          <span className="mono-num text-[10px] text-text-muted">{signal.timeframe}</span>
        </div>
        <ScoreMeter score={signal.score} />
      </div>

      <div className="mono-num mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
        <Level label="Entry" value={signal.entryPrice} />
        <Level label="Invalidation (SL)" value={signal.invalidationPrice} />
        <Level label="TP1" value={signal.tp1Price} />
        <Level label="TP2" value={signal.tp2Price} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted">R:R</span>
          <span className="font-bold text-white">{signal.rrRatio.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted">RSI</span>
          <span className="font-bold text-white">{formatRsi(signal.rsiValue)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted">RVOL</span>
          <span className="font-bold text-amber-400">{formatRvol(signal.rvolValue)}</span>
        </div>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1">
        {signal.reasons.map((r) => (
          <li key={r}>
            <Pill tone="blue">{r}</Pill>
          </li>
        ))}
      </ul>

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] font-semibold text-text-muted hover:text-white">
          Score breakdown ({signal.score}/100)
        </summary>
        <div className="mono-num mt-1.5 grid grid-cols-2 gap-1 text-[10px] text-text-secondary sm:grid-cols-4">
          {Object.entries(signal.scoreBreakdown)
            .filter(([k]) => k !== 'total')
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-1 rounded bg-white/[0.03] px-1.5 py-0.5">
                <span className="capitalize">{k === 'rr' ? 'R:R' : k}</span>
                <span className={k === 'risk' && Number(v) > 0 ? 'text-red-400' : 'text-white'}>{String(v)}</span>
              </div>
            ))}
        </div>
      </details>
      </article>
    </TiltCard>
  );
}

function Level({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-muted">{label}</span>
        <span className="text-text-muted">—</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <CopyableValue value={levelCopyValue(value)} display={levelCopyValue(value)} copyLabel={label} />
    </div>
  );
}

function StageBadge({ stage, direction, label }: { stage: SignalStage; direction: SignalDirection; label: string }) {
  if (stage === 'ENTRY_READY') {
    return (
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
          direction === 'LONG' ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'
        }`}
      >
        {label}
      </span>
    );
  }
  return <Pill tone={STAGE_TONE[stage]}>{label}</Pill>;
}

/** §7.1  WebAudio chime — engaged only after a user gesture (Start / Test). */
export function playChime(volumePct = 60): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volumePct / 100)) * 0.25;
    gain.connect(ctx.destination);

    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      const start = ctx.currentTime + i * 0.11;
      osc.start(start);
      osc.stop(start + 0.16);
    });
    setTimeout(() => void ctx.close(), 700);
  } catch {
    /* Audio unavailable — silently ignore. */
  }
}
