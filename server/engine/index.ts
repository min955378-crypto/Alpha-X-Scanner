import { SCANNERS, type BootStatus, type MarketFrame, type ScannerSlug, type ScannerSignal, type ServerMessage, type SystemHealth, type Timeframe } from '@/lib/types';
import { WEIGHT_CAP_PER_MIN, WeightMeter, fetchUniverse, klinesWeight, probe } from './binance';
import { getDb } from './db';
import { listRiskItems, refreshRiskWatch, seedSnapshot } from './riskwatch';
import { runScanner } from './scanners';
import { MarketStore } from './store';
import { buildUniverse, monitoringTagSet } from './universe';

/**
 * §2.1  GLOBAL SINGLETON QUANT WORKER.
 *
 * Exactly one instance per process — never one loop per user. It:
 *   • boots the universe with the two-phase, weight-capped cold start (§2.2)
 *   • keeps 1 Hz price ticks and rolls candles on real interval boundaries
 *   • recomputes intrabar Wilder RSI / EMA / ATR / RVOL every 60 seconds
 *   • runs all five scanners once per cycle
 *   • fans results out to subscribed WebSocket sessions, filtered by entitlement
 */

export interface EngineListener {
  (msg: ServerMessage): void;
}

const TICK_MS = 1000;
const CYCLE_MS = 60_000;
/** §2.2  Phase A: 20 req/s × weight 1 → 612 coins in 30.6s. */
const PHASE_A_RPS = Number(process.env.SCALPPRO_PHASE_A_RPS ?? 20);
/** §2.2  Phase B: 3.5 req/s × weight 5 → 1,050 weight/min, ~2.9 min. */
const PHASE_B_RPS = Number(process.env.SCALPPRO_PHASE_B_RPS ?? 3.5);
const RISK_REFRESH_MS = 60 * 60 * 1000;

class Engine {
  readonly store = new MarketStore();
  readonly meter = new WeightMeter();

  dataMode: 'LIVE' | 'SIMULATED' = 'SIMULATED';
  boot: BootStatus = {
    phase: 'IDLE',
    seeded: 0,
    total: 0,
    weightUsedMin: 0,
    phaseAReady: false,
    phaseBReady: false,
    elapsedSec: 0,
    phaseAElapsedSec: null,
  };

  cycle = 0;
  startedAt = Date.now();
  nextCycleAt = Date.now() + CYCLE_MS;
  frames = new Map<Timeframe, MarketFrame>();
  signals = new Map<ScannerSlug, ScannerSignal[]>();
  lastScanAt = new Map<ScannerSlug, number>();
  riskUpdatedAt: number | null = null;
  riskNextAt = Date.now() + RISK_REFRESH_MS;
  riskError: string | null = null;

  requestedTimeframes = new Set<Timeframe>(['1H']);
  requestedScanners = new Set<ScannerSlug>(SCANNERS.map((s) => s.slug));
  wsClients = 0;

  private listeners = new Set<EngineListener>();
  private lastBroadcast = new Map<string, number>();
  private tickTimer: NodeJS.Timeout | null = null;
  private cycleTimer: NodeJS.Timeout | null = null;
  private phaseATimer: NodeJS.Timeout | null = null;
  private phaseBTimer: NodeJS.Timeout | null = null;
  private started = false;
  private starting: Promise<void> | null = null;
  private seedQueue: string[] = [];
  private backfillQueue: string[] = [];

  /* ------------------------------ lifecycle ------------------------------ */

  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.boot_();
    return this.starting;
  }

  private async boot_(): Promise<void> {
    this.started = true;
    const db = getDb();

    /* Universe: live exchangeInfo when reachable, bundled snapshot otherwise. */
    const monitoring = monitoringTagSet();
    let entries = await fetchUniverse(monitoring);
    if (entries) {
      this.dataMode = 'LIVE';
    } else {
      entries = buildUniverse();
      this.dataMode = 'SIMULATED';
      const reachable = await probe();
      if (reachable) {
        entries = (await fetchUniverse(monitoring)) ?? entries;
        this.dataMode = 'LIVE';
      }
    }

    this.store.setUniverse(entries);
    this.boot.total = entries.length;
    this.boot.phase = 'PHASE_A';

    console.log(
      `[engine] ${this.dataMode} mode · ${entries.length} coins · Phase A at ${PHASE_A_RPS} req/s (weight 1 each)`,
    );

    /* Risk Watch: seed from the bundled snapshot, then try a live BAPI sync. */
    seedSnapshot();
    this.riskUpdatedAt = Date.now();
    void this.refreshRisk();

    /* Phase A — fast warm-up (limit=99, weight 1). */
    this.seedQueue = this.store.order.slice();
    this.phaseATimer = setInterval(() => {
      const symbol = this.seedQueue.shift();
      if (!symbol) {
        if (this.phaseATimer) clearInterval(this.phaseATimer);
        this.phaseATimer = null;
        this.boot.phaseAReady = true;
        this.boot.phaseAElapsedSec = Math.round(((Date.now() - this.startedAt) / 1000) * 10) / 10;
        this.boot.phase = 'PHASE_B';
        console.log(
          `[engine] Phase A complete — ${this.boot.seeded} coins in ${this.boot.phaseAElapsedSec}s ` +
            `(budget 31s · peak weight ${this.meter.reported()}/${WEIGHT_CAP_PER_MIN} per min)`,
        );
        this.startPhaseB();
        return;
      }
      this.store.seedSymbol(symbol, Date.now());
      this.meter.add(klinesWeight(99));
      this.boot.seeded += 1;
      this.emitBoot();
    }, Math.max(5, Math.round(1000 / PHASE_A_RPS)));

    /* Ticks + cycles run from the very first second. */
    this.tickTimer = setInterval(() => this.onTick(), TICK_MS);
    this.cycleTimer = setInterval(() => this.onCycle(), CYCLE_MS);
    setInterval(() => void this.refreshRisk(), RISK_REFRESH_MS).unref?.();
  }

  private startPhaseB(): void {
    this.backfillQueue = this.store.order.slice();
    this.phaseBTimer = setInterval(() => {
      const symbol = this.backfillQueue.shift();
      if (!symbol) {
        if (this.phaseBTimer) clearInterval(this.phaseBTimer);
        this.phaseBTimer = null;
        this.boot.phaseBReady = true;
        this.boot.phase = 'READY';
        // Drop the cached frames: every one of them was built before the last
        // symbols were backfilled, so they still report wr500 = null.
        this.frames.clear();
        this.emitBoot();
        console.log('[engine] Phase B complete — 500-candle backfill ready on all timeframes');
        return;
      }
      this.store.markBackfilled(symbol);
      this.meter.add(klinesWeight(500));
      this.emitBoot();
    }, Math.max(20, Math.round(1000 / PHASE_B_RPS)));
  }

  /* -------------------------------- ticks -------------------------------- */

  private onTick(): void {
    const now = Date.now();
    this.store.tick(now, 1);
    const closed = this.store.rollCandles(now);
    if (closed > 0) console.log(`[engine] rolled ${closed} candles`);

    const updates: Array<[string, number, number]> = [];
    for (const st of this.store.symbols.values()) {
      if (!st.enabled) continue;
      const prev = this.lastBroadcast.get(st.entry.symbol);
      if (prev === undefined || Math.abs(prev - st.price) > 0) {
        updates.push([st.entry.symbol, st.price, Math.round(st.changePct24h * 100) / 100]);
        this.lastBroadcast.set(st.entry.symbol, st.price);
      }
    }
    if (updates.length) this.emit({ type: 'tick', t: now, u: updates });

    this.boot.elapsedSec = Math.round((now - this.startedAt) / 1000);
    this.boot.weightUsedMin = this.meter.reported();
  }

  /* -------------------------------- cycle -------------------------------- */

  private onCycle(): void {
    const now = Date.now();
    this.cycle += 1;

    /* §7.3  Scanners run FIRST: frames carry each coin's best signal score,
       so the heatmap / Pro Table / Coin Finder show the same number the
       scanner's signal card shows. */
    const scores = new Map<string, number>();
    for (const slug of this.requestedScanners) {
      try {
        const cfg = getDb().scannerConfigs.get(slug);
        if (cfg && !cfg.enabled) {
          this.signals.set(slug, []);
          continue;
        }
        const tf = cfg?.defaultTimeframe ?? '1H';
        const list = runScanner(slug, this.store, tf, now, this.cycle);
        this.signals.set(slug, list);
        this.lastScanAt.set(slug, now);
        for (const sig of list) {
          const key = `${sig.symbol}|${tf}`;
          const prev = scores.get(key) ?? 0;
          if (sig.score > prev) scores.set(key, sig.score);
        }
        this.emit({ type: 'signals', scannerSlug: slug, signals: list });
      } catch (err) {
        console.error(`[engine] scanner ${slug} failed`, err);
      }
    }
    this.store.setScores(scores);

    for (const tf of this.requestedTimeframes) {
      const frame = this.store.buildFrame(tf, now, 60, this.cycle, this.dataMode, this.boot, this.riskUpdatedAt);
      this.frames.set(tf, frame);
      this.emit({ type: 'frame', frame });
    }

    this.nextCycleAt = now + CYCLE_MS;
    this.emitBoot();
  }

  scanNow(slug: ScannerSlug): ScannerSignal[] {
    const cfg = getDb().scannerConfigs.get(slug);
    const tf = cfg?.defaultTimeframe ?? '1H';
    const list = runScanner(slug, this.store, tf, Date.now(), this.cycle + 10_000_000);
    this.signals.set(slug, list);
    this.lastScanAt.set(slug, Date.now());
    this.emit({ type: 'signals', scannerSlug: slug, signals: list });
    return list;
  }

  async refreshRisk(): Promise<void> {
    const res = await refreshRiskWatch();
    this.riskUpdatedAt = Date.now();
    this.riskNextAt = Date.now() + RISK_REFRESH_MS;
    this.riskError = res.error;
    if (res.ok) console.log(`[risk-watch] live BAPI sync upserted ${res.upserted} rows`);
    this.emit({ type: 'riskwatch', updatedAt: this.riskUpdatedAt });
    this.emitBoot();
  }

  /* -------------------------------- access ------------------------------- */

  requestTimeframe(tf: Timeframe): void {
    this.requestedTimeframes.add(tf);
    if (!this.frames.has(tf)) {
      const frame = this.store.buildFrame(tf, Date.now(), 60, this.cycle, this.dataMode, this.boot, this.riskUpdatedAt);
      this.frames.set(tf, frame);
    }
  }

  getFrame(tf: Timeframe): MarketFrame | null {
    const cached = this.frames.get(tf);
    if (cached) return cached;
    // Build on demand (e.g. right after the frame cache was invalidated).
    const frame = this.store.buildFrame(tf, Date.now(), 60, this.cycle, this.dataMode, this.boot, this.riskUpdatedAt);
    this.frames.set(tf, frame);
    return frame;
  }

  getSignals(slug: ScannerSlug): ScannerSignal[] {
    return this.signals.get(slug) ?? [];
  }

  secondsToNextCycle(): number {
    return Math.max(0, Math.round((this.nextCycleAt - Date.now()) / 1000));
  }

  /* ------------------------------ pub / sub ------------------------------ */

  addListener(fn: EngineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(msg: ServerMessage): void {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {
        /* A dead listener must never break the cycle. */
      }
    }
  }

  private emitBoot(): void {
    this.emit({ type: 'boot', boot: this.boot });
  }

  /* -------------------------------- health ------------------------------- */

  getHealth(): SystemHealth {
    const db = getDb();
    let activeKeys = 0;
    for (const l of db.licenses.values()) if (l.status === 'ACTIVE') activeKeys += 1;

    return {
      totalUsers: db.users.size,
      activeLicenseKeys: activeKeys,
      onlineWsClients: this.wsClients,
      coinsTracked: this.store.symbols.size,
      phaseAReady: this.boot.phaseAReady,
      phaseAElapsedSec: this.boot.phaseAElapsedSec,
      phaseBReady: this.boot.phaseBReady,
      binanceWeightUsed: this.meter.reported(),
      binanceWeightCap: WEIGHT_CAP_PER_MIN,
      wsPool: {
        streams: this.requestedTimeframes.size * this.store.symbols.size + 1,
        connections: 2,
        subscriptions: Object.fromEntries([...this.requestedTimeframes].map((tf) => [tf, this.store.symbols.size])),
      },
      dataMode: this.dataMode,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      scanCycle: this.cycle,
      heapUsedMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
    };
  }

  getRiskItems() {
    return listRiskItems();
  }
}

const GLOBAL_KEY = '__scalppro_engine__';

export function getEngine(): Engine {
  const g = globalThis as unknown as Record<string, Engine | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Engine();
  return g[GLOBAL_KEY] as Engine;
}

export { Engine };
