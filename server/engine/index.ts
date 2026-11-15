import {
  SCANNERS,
  type BootStatus,
  type CustomSignal,
  type MarketFrame,
  type ScannerSlug,
  type ScannerSignal,
  type ScoreBreakdown,
  type ServerMessage,
  type SystemHealth,
  type Timeframe,
} from '@/lib/types';
import {
  MiniTickerStream,
  WEIGHT_CAP_PER_MIN,
  WeightMeter,
  activeProviderId,
  fetchFundingRates,
  fetchKlines,
  fetchTickers,
  fetchUniverse,
  klinesWeight,
  probe,
  type MiniTickerRow,
} from './binance';
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
const PHASE_A_RPS = Number(process.env.ALPHAX_PHASE_A_RPS ?? 20);
/** §2.2  Phase B: 3.5 req/s × weight 5 → 1,050 weight/min, ~2.9 min. */
const PHASE_B_RPS = Number(process.env.ALPHAX_PHASE_B_RPS ?? 3.5);
/**
 * §1.2  Bulk 24h ticker refresh. One request covers all 600+ coins, so this is
 * cheap; it is what keeps the 24h change, high/low and quote volume real after
 * the socket (which carries price and volume only) has been running.
 */
const TICKER_REFRESH_MS = 60_000;
/**
 * §1.2.2  Funding rates settle every 8h on Binance. Refreshing far more often
 * than that is wasted weight, but often enough that a new period shows up
 * promptly.
 */
const FUNDING_REFRESH_MS = 5 * 60_000;
/**
 * §1.3  Parallel kline warm-up. 40 concurrent sockets finishes the book in
 * ~15 waves; higher concurrency trips Binance's rate limiter and earns a 429
 * that costs far more time than the parallelism saves.
 */
const KLINE_CONCURRENCY = 40;
/** §1.3  99 candles → REST weight 1 per symbol (100 would cost 2). */
const KLINE_WARMUP_LIMIT = 99;
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
  /** MODULE 1  Wall-clock ms of the most recent all-scanner sweep. */
  lastScanDurationMs: number | null = null;
  /** MODULE 1  Round-trip latency of the market socket, in ms. */
  wsLatencyMs: number | null = null;
  riskNextAt = Date.now() + RISK_REFRESH_MS;
  riskError: string | null = null;

  requestedTimeframes = new Set<Timeframe>(['1H']);
  /** §1.3  Timeframes whose real kline warm-up has already been kicked off. */
  private warmedTfs = new Set<Timeframe>();
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
  /** §4.2  1 Hz `!miniTicker@arr` stream — zero REST weight. */
  private miniTicker: MiniTickerStream | null = null;

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

    /* §3  Adopt whatever Postgres already holds before anything reads the db,
       so admin changes survive a serverless cold start. Failure is
       non-fatal — the in-memory store stays authoritative. */
    await db.hydrateFromPostgres();

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
    this.applyCoinOverrides();
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
    /* §4.2  In LIVE mode the 1 Hz price feed comes off the combined
       miniTicker socket instead of REST polling. */
    if (this.dataMode === 'LIVE' && typeof WebSocket !== 'undefined') {
      this.miniTicker = new MiniTickerStream((rows) => this.onMiniTicker(rows));
      this.miniTicker.start();
      console.log('[engine] !miniTicker@arr stream attached (0 REST weight)');
    }

    /* §1.2  Pull the whole book's quotes and funding rates in two requests.
       Deliberately not awaited: on a serverless host the first frame must not
       wait on a network round trip. The baseline the store just built is what
       the first request serves; this upgrades every coin to real numbers the
       moment it lands, typically inside a second. */
    void this.hydrateLive();

    this.tickTimer = setInterval(() => this.onTick(), TICK_MS);
    this.cycleTimer = setInterval(() => this.onCycle(), CYCLE_MS);
    setInterval(() => void this.refreshRisk(), RISK_REFRESH_MS).unref?.();

    if (this.dataMode === 'LIVE') {
      setInterval(() => void this.pullTickers(), TICKER_REFRESH_MS).unref?.();
      setInterval(() => void this.pullFunding(), FUNDING_REFRESH_MS).unref?.();
    }
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

  /* ---------------------------- §1.2 live quotes -------------------------- */

  /**
   * §1.2  Replace simulated quotes with the real book in one round trip.
   *
   * Two requests — spot 24h tickers and perpetual funding — cover all 600+
   * coins. Doing this per-symbol would be 600 requests and would blow the REST
   * weight budget before the first frame was ever served.
   */
  private async hydrateLive(): Promise<void> {
    if (this.dataMode !== 'LIVE') return;
    await Promise.all([this.pullTickers(), this.pullFunding()]);
    /* §1.3  Only now is the volume ordering real, so warm the default
       timeframe after the tickers land rather than alongside them. */
    void this.warmKlines('1H');
  }

  /** §1.2.1  Bulk spot tickers → price, 24h change/volume/high/low, spread. */
  private async pullTickers(): Promise<void> {
    try {
      const tickers = await fetchTickers();
      if (!tickers) return;
      let applied = 0;
      for (const t of tickers.values()) {
        if (this.store.applyTicker(t)) applied += 1;
      }
      /* Drop cached frames: they were built from the pre-ticker prices. */
      this.frames.clear();
      console.log(`[engine] bulk ticker applied — ${applied}/${tickers.size} coins`);
    } catch (err) {
      console.warn('[engine] bulk ticker failed', err instanceof Error ? err.message : err);
    }
  }

  /* ---------------------------- §1.3 kline warm-up ------------------------ */

  /**
   * §1.3  Pull real candles for every coin in fast concurrent batches.
   *
   * `limit=99` is deliberate: Binance charges weight 1 for ≤99 candles and
   * weight 2 above that, so the whole 600-coin book costs ~601 weight — inside
   * the 1,200/min cap — instead of 1,202, which would tip the meter over.
   * 500-candle history arrives later via Phase B and the on-demand chart
   * route, both of which already exist.
   *
   * Batches are ordered by 24h quote volume descending, so if the process is
   * frozen mid-run (routine on serverless) the coins that got real history are
   * the ones traders actually look at. Everything else keeps its baseline
   * rather than disappearing from the frame.
   *
   * Never throws and never blocks boot — the frame is already complete from
   * the baseline, so a failure here only means the coins stay synthetic until
   * the next attempt.
   */
  private async warmKlines(tf: Timeframe): Promise<void> {
    if (this.dataMode !== 'LIVE') return;
    if (this.warmedTfs.has(tf)) return;
    this.warmedTfs.add(tf);

    const symbols = this.store
      .list()
      .filter((st) => st.enabled)
      .sort((a, b) => b.quoteVol24h - a.quoteVol24h)
      .map((st) => st.entry.symbol);

    const startedAt = Date.now();
    let real = 0;
    let failed = 0;

    for (let i = 0; i < symbols.length; i += KLINE_CONCURRENCY) {
      const batch = symbols.slice(i, i + KLINE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((sym) => fetchKlines(sym, tf, KLINE_WARMUP_LIMIT)),
      );
      for (let j = 0; j < batch.length; j += 1) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value && r.value.length) {
          if (this.store.seedFromCandles(batch[j], tf, r.value)) real += 1;
          else failed += 1;
        } else {
          failed += 1;
        }
      }
      this.meter.add(batch.length * klinesWeight(KLINE_WARMUP_LIMIT));
    }

    /* Frames built during the warm-up describe the old candles. */
    this.frames.clear();
    console.log(
      `[engine] ${tf} kline warm-up — ${real} real, ${failed} fallback ` +
        `(${Date.now() - startedAt}ms, ${symbols.length} coins @ ${KLINE_CONCURRENCY} concurrent)`,
    );
  }

  /** §1.2.2  Perpetual funding rates → Column 11 of the Pro Table. */
  private async pullFunding(): Promise<void> {
    try {
      const rates = await fetchFundingRates();
      if (!rates) return;
      /* Reconciled rather than merged: a coin absent from the exchange's map
         has no perpetual, and must be cleared rather than left carrying the
         simulated profile's flag. */
      const { withPerp, spotOnly } = this.store.reconcileFunding(rates);
      this.frames.clear();
      console.log(`[engine] funding rates applied — ${withPerp} perpetuals, ${spotOnly} spot-only`);
    } catch (err) {
      console.warn('[engine] funding sync failed', err instanceof Error ? err.message : err);
    }
  }

  /* -------------------------------- ticks -------------------------------- */

  private onTick(): void {
    const now = Date.now();
    /* LIVE prices belong to the ticker feed and the socket, not the simulator. */
    this.store.tick(now, 1, this.dataMode === 'LIVE');
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

  /**
   * §4.2  One `!miniTicker@arr` frame carries every symbol. We only touch the
   * store here — the 1 Hz `onTick` broadcast picks the diff up on its next
   * pass, so a burst of rows cannot cause a burst of renders.
   */
  private onMiniTicker(rows: MiniTickerRow[]): void {
    for (const r of rows) {
      if (!r.s) continue;
      const last = Number(r.c);
      const qv = r.q === undefined ? null : Number(r.q);
      if (Number.isFinite(last) && last > 0) this.store.applyMiniTicker(r.s, last, qv);
    }
  }

  /* -------------------------------- cycle -------------------------------- */

  private onCycle(): void {
    const now = Date.now();
    this.cycle += 1;

    /* §7.3  Scanners run FIRST: frames carry each coin's best signal score,
       so the heatmap / Pro Table / Coin Finder show the same number the
       scanner's signal card shows. */
    const scores = new Map<string, number>();
    const scanStartedAt = Date.now();
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
    this.lastScanDurationMs = Date.now() - scanStartedAt;

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
    /* §7.1  A newly requested timeframe has only baseline candles. Warm it in
       the background; the baseline it serves in the meantime is complete and
       valid, so the switch is instant either way. */
    void this.warmKlines(tf);
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

  /**
   * MODULE 6  Admin-published VIP signals are merged in ABOVE the engine
   * output so a manual high-conviction setup is the first thing a customer
   * sees, and are re-served on every reconnect because they live in the DB.
   */
  getSignals(slug: ScannerSlug): ScannerSignal[] {
    const engineSignals = this.signals.get(slug) ?? [];
    const custom = getDb()
      .listCustomSignals()
      .filter((c) => c.scannerSlug === slug)
      .map(customSignalToScannerSignal);
    return [...custom, ...engineSignals];
  }

  /** MODULE 6  Push the merged signal lists to every subscribed socket now. */
  broadcastSignals(): void {
    for (const slug of this.requestedScanners) {
      this.emit({ type: 'signals', scannerSlug: slug, signals: this.getSignals(slug) });
    }
  }

  /**
   * MODULE 6  Re-apply the operator's persisted coin overrides after a
   * universe rebuild, so an admin's enable / ⚠ decisions survive a restart or
   * a forced reseed instead of reverting to the exchange defaults.
   */
  private applyCoinOverrides(): number {
    const overrides = getDb().coinOverrides;
    let applied = 0;
    for (const [symbol, o] of Object.entries(overrides)) {
      const st = this.store.symbols.get(symbol);
      if (!st) continue;
      st.enabled = o.enabled;
      st.isMonitoringTag = o.isMonitoringTag;
      st.manualTagOverride = o.manualTagOverride;
      applied += 1;
    }
    return applied;
  }

  /**
   * MODULE 1  Force Market Reseed.
   *
   * Re-fetches the exchange universe (live if reachable, bundled snapshot
   * otherwise) and restarts the Phase A warm-up / Phase B 500-candle backfill
   * ladder. Existing symbol state is reused wherever the symbol still exists so
   * the terminal never goes blank mid-reseed.
   */
  async reseed(): Promise<{ coins: number; mode: 'LIVE' | 'SIMULATED' }> {
    const monitoring = monitoringTagSet();
    let entries = await fetchUniverse(monitoring);
    if (entries) {
      this.dataMode = 'LIVE';
    } else {
      entries = buildUniverse();
      this.dataMode = 'SIMULATED';
    }

    this.store.setUniverse(entries);
    this.applyCoinOverrides();
    this.boot.total = entries.length;
    this.boot.seeded = 0;
    this.boot.phaseAReady = false;
    this.boot.phaseBReady = false;
    this.boot.phaseAElapsedSec = null;
    this.boot.phase = 'PHASE_A';
    this.frames.clear();
    this.signals.clear();

    if (this.phaseATimer) clearInterval(this.phaseATimer);
    if (this.phaseBTimer) clearInterval(this.phaseBTimer);
    this.phaseBTimer = null;

    this.seedQueue = this.store.order.slice();
    this.phaseATimer = setInterval(() => {
      const symbol = this.seedQueue.shift();
      if (!symbol) {
        if (this.phaseATimer) clearInterval(this.phaseATimer);
        this.phaseATimer = null;
        this.boot.phaseAReady = true;
        this.boot.phaseAElapsedSec = Math.round(((Date.now() - this.startedAt) / 1000) * 10) / 10;
        this.boot.phase = 'PHASE_B';
        this.startPhaseB();
        return;
      }
      this.store.seedSymbol(symbol, Date.now());
      this.meter.add(klinesWeight(99));
      this.boot.seeded += 1;
      this.emitBoot();
    }, Math.max(5, Math.round(1000 / PHASE_A_RPS)));

    this.emitBoot();
    return { coins: entries.length, mode: this.dataMode };
  }

  /**
   * MODULE 5  Hot-reload the quant engine after an admin saves scanner
   * parameters. Rebuilds the warm-up series the store derives from the tuned
   * structural values, then rescans every requested scanner immediately.
   */
  applyScannerConfig(): { rewarmed: number; rescanned: ScannerSlug[] } {
    const rewarmed = this.store.rewarm();
    const rescanned: ScannerSlug[] = [];
    const now = Date.now();
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
        this.emit({ type: 'signals', scannerSlug: slug, signals: list });
        rescanned.push(slug);
      } catch (err) {
        console.error(`[engine] hot-reload rescan failed for ${slug}`, err);
      }
    }
    this.emitBoot();
    return { rewarmed, rescanned };
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
      provider: activeProviderId(),
      wsPool: {
        streams: this.requestedTimeframes.size * this.store.symbols.size + 1,
        connections: 2,
        subscriptions: Object.fromEntries([...this.requestedTimeframes].map((tf) => [tf, this.store.symbols.size])),
      },
      dataMode: this.dataMode,
      lastScanDurationMs: this.lastScanDurationMs,
      wsLatencyMs: this.wsLatencyMs,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      scanCycle: this.cycle,
      heapUsedMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
    };
  }

  getRiskItems() {
    return listRiskItems();
  }
}

/**
 * MODULE 6  Adapt a persisted `CustomSignal` into the wire `ScannerSignal`
 * shape. Score is redistributed across the breakdown so the signal card
 * renders the admin's number as `total` without inventing fake sub-scores.
 */
function customSignalToScannerSignal(c: CustomSignal): ScannerSignal {
  const share = Math.round(c.score / 8);
  const breakdown: ScoreBreakdown = {
    structure: share,
    volume: share,
    trend: share,
    htf: share,
    rr: share,
    liquidity: share,
    risk: share,
    total: c.score,
  };

  return {
    id: c.id,
    scannerSlug: c.scannerSlug,
    symbol: c.symbol,
    baseAsset: c.baseAsset,
    timeframe: c.timeframe,
    direction: c.direction,
    stage: 'ENTRY_READY',
    score: c.score,
    scoreBreakdown: breakdown,
    entryPrice: c.entryPrice,
    invalidationPrice: c.invalidationPrice,
    tp1Price: c.tp1Price,
    tp2Price: c.tp2Price,
    rrRatio:
      Math.abs(c.entryPrice - c.invalidationPrice) > 0
        ? Math.abs((c.tp1Price - c.entryPrice) / (c.entryPrice - c.invalidationPrice))
        : 0,
    rsiValue: 0,
    rvolValue: 0,
    reasons: [`★ VIP MANUAL SIGNAL — ${c.createdBy}`, ...c.reasons, ...(c.note ? [c.note] : [])],
    isMonitoringTag: false,
    createdAt: c.createdAt,
    validUntil: c.validUntil ?? Number.MAX_SAFE_INTEGER,
  };
}

const GLOBAL_KEY = '__alpha_x_engine__';

export function getEngine(): Engine {
  const g = globalThis as unknown as Record<string, Engine | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Engine();
  return g[GLOBAL_KEY] as Engine;
}

export { Engine };
