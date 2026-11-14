/**
 * Alpha X Scanner — shared, isomorphic type contracts.
 *
 * Everything on the wire between the Global Quant Worker and the React client
 * is described here so that the compact encoding in `lib/wire.ts` and the
 * decoders can never drift apart silently.
 */

export type Timeframe = '15M' | '30M' | '1H' | '4H' | '1D';

export const TIMEFRAMES: Timeframe[] = ['15M', '30M', '1H', '4H', '1D'];

/** Timeframe -> TradingView interval token (spec §9.1). */
export const TF_TO_TV: Record<Timeframe, string> = {
  '15M': '15',
  '30M': '30',
  '1H': '60',
  '4H': '240',
  '1D': 'D',
};

/** Timeframe -> Binance kline interval token. */
export const TF_TO_BINANCE: Record<Timeframe, string> = {
  '15M': '15m',
  '30M': '30m',
  '1H': '1h',
  '4H': '4h',
  '1D': '1d',
};

/** Bar duration in seconds (used by the RVOL(20) normaliser, spec §6.2). */
export const TF_SECONDS: Record<Timeframe, number> = {
  '15M': 900,
  '30M': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

/** Next-higher timeframe used by the Higher-Timeframe Alignment score (§7.3 #4). */
export const TF_NEXT_UP: Record<Timeframe, Timeframe> = {
  '15M': '1H',
  '30M': '1H',
  '1H': '4H',
  '4H': '1D',
  '1D': '1D',
};

/* -------------------------------------------------------------------------- */
/* RSI HEATMAP ZONES (spec §6.3)                                              */
/* -------------------------------------------------------------------------- */

export type ZoneId = 'GAINERS' | 'V1' | 'NEUTRAL' | 'HIDDEN_BULL' | 'OVERSOLD' | 'EXTREME';

export interface ZoneDef {
  id: ZoneId;
  title: string;
  emoji: string;
  /** Inclusive lower bound (null = -Infinity). */
  min: number | null;
  /** Exclusive upper bound (null = +Infinity). */
  max: number | null;
  accent: string;
  cssBg: string;
  cssBorder: string;
  filterLabel: string;
}

/** Ordered top-to-bottom exactly as the dashboard renders them (spec §6.3). */
export const ZONES: ZoneDef[] = [
  {
    id: 'GAINERS',
    title: 'Gainers Zone',
    emoji: '🚀',
    min: 60,
    max: null,
    accent: '#A78BFA',
    cssBg: 'var(--tile-gainers-bg)',
    cssBorder: 'var(--tile-gainers-border)',
    filterLabel: '60+ Gainers',
  },
  {
    id: 'V1',
    title: 'V1 Zone',
    emoji: '⚡',
    min: 50,
    max: 60,
    accent: '#22C55E',
    cssBg: 'var(--tile-v1-bg)',
    cssBorder: 'var(--tile-v1-border)',
    filterLabel: '50-60 V1 Zone',
  },
  {
    id: 'NEUTRAL',
    title: 'Neutral',
    emoji: '⬜',
    min: 40,
    max: 50,
    accent: '#7E8FA6',
    cssBg: 'var(--tile-neutral-bg)',
    cssBorder: 'var(--tile-neutral-border)',
    filterLabel: '40-50 Neutral',
  },
  {
    id: 'HIDDEN_BULL',
    title: 'Hidden Bull & ICT',
    emoji: '🔵',
    min: 30,
    max: 40,
    accent: '#60A5FA',
    cssBg: 'var(--tile-hiddenbull-bg)',
    cssBorder: 'var(--tile-hiddenbull-border)',
    filterLabel: '30-40 Hidden Bull & ICT',
  },
  {
    id: 'OVERSOLD',
    title: 'Oversold',
    emoji: '🟠',
    min: 20,
    max: 30,
    accent: '#F97316',
    cssBg: 'var(--tile-oversold-bg)',
    cssBorder: 'var(--tile-oversold-border)',
    filterLabel: '20-30 Oversold',
  },
  {
    id: 'EXTREME',
    title: 'Extreme',
    emoji: '🔴',
    min: null,
    max: 20,
    accent: '#F87171',
    cssBg: 'var(--tile-extreme-bg)',
    cssBorder: 'var(--tile-extreme-border)',
    filterLabel: '10-20 Extreme',
  },
];

export function zoneForRsi(rsi: number): ZoneDef {
  for (const z of ZONES) {
    const loOk = z.min === null || rsi >= z.min;
    const hiOk = z.max === null || rsi < z.max;
    if (loOk && hiOk) return z;
  }
  return ZONES[2];
}

/* -------------------------------------------------------------------------- */
/* SCANNERS (spec §7)                                                         */
/* -------------------------------------------------------------------------- */

export type ScannerSlug = 'v1-scaling' | 'order-block' | 'ema-crossover' | 'hidden-bullish' | 'alpha-sniper';

export interface ScannerMeta {
  slug: ScannerSlug;
  /** Tab label (spec §5.2) — note `V1 Scaling` vs the sidebar's `V1 Scalping`. */
  tabLabel: string;
  /** Right-sidebar status-row label (spec §6.6). */
  sidebarLabel: string;
  name: string;
  /** Micro-accent only — navigation renders the vector `icon` instead. */
  emoji: string;
  /** Key into components/ui/Icons. */
  icon: 'bolt' | 'blocks' | 'trending' | 'hidden' | 'crosshair';
  accent: string;
  category: string;
  tfLabel: string;
  subtitle: string;
  entitlementKey: EntitlementKey;
}

export type EntitlementKey =
  | 'canAccessV1Scaling'
  | 'canAccessOrderBlock'
  | 'canAccessEmaCrossover'
  | 'canAccessHiddenBullish'
  | 'canAccessAlphaSniper';

export const SCANNERS: ScannerMeta[] = [
  {
    slug: 'v1-scaling',
    tabLabel: 'V1 Scaling',
    sidebarLabel: 'V1 Scalping',
    name: 'V1 Scaling',
    emoji: '⚡',
    icon: 'bolt',
    accent: '#22C55E',
    category: 'Momentum Zone',
    tfLabel: '1H',
    subtitle: 'V1 zone screening · Momentum building · Breakout confirmation',
    entitlementKey: 'canAccessV1Scaling',
  },
  {
    slug: 'order-block',
    tabLabel: 'Order Block',
    sidebarLabel: 'Order Block',
    name: 'Order Block',
    emoji: '🟩',
    icon: 'blocks',
    accent: '#22C55E',
    category: 'Institutional SMC',
    tfLabel: '15M / 1H',
    subtitle: 'Unmitigated OB detection · Zone tap monitoring · Rejection confirmation',
    entitlementKey: 'canAccessOrderBlock',
  },
  {
    slug: 'ema-crossover',
    tabLabel: 'EMA Crossover',
    sidebarLabel: 'EMA Crossover',
    name: 'EMA Crossover',
    emoji: '📈',
    icon: 'trending',
    accent: '#60A5FA',
    category: 'Trend Continuation',
    tfLabel: '15M / 1H',
    subtitle: 'EMA stack screening · Pullback / Cross monitoring · Momentum confirmation',
    entitlementKey: 'canAccessEmaCrossover',
  },
  {
    slug: 'hidden-bullish',
    tabLabel: 'Hidden Bullish',
    sidebarLabel: 'Hidden Bullish',
    name: 'Hidden Bullish',
    emoji: '🔵',
    icon: 'hidden',
    accent: '#60A5FA',
    category: 'Precision Setup',
    tfLabel: '1H',
    subtitle: 'Structure screening · Setup monitoring · Entry confirmation',
    entitlementKey: 'canAccessHiddenBullish',
  },
  {
    slug: 'alpha-sniper',
    tabLabel: 'Alpha Sniper',
    sidebarLabel: 'Alpha Sniper',
    name: 'Alpha Sniper',
    emoji: '🎯',
    icon: 'crosshair',
    accent: '#A78BFA',
    category: 'Sniper Confluence',
    tfLabel: '15M / 1H',
    subtitle: 'Channel extreme screening · EMA13/34 alignment · Alpha trigger confirmation',
    entitlementKey: 'canAccessAlphaSniper',
  },
];

export const SCANNER_BY_SLUG: Record<ScannerSlug, ScannerMeta> = SCANNERS.reduce(
  (acc, s) => ({ ...acc, [s.slug]: s }),
  {} as Record<ScannerSlug, ScannerMeta>,
);

export type SignalDirection = 'LONG' | 'SHORT';
export type SignalStage = 'POTENTIAL' | 'WAITING' | 'ENTRY_READY' | 'EXPIRED' | 'INVALIDATED';

export interface ScoreBreakdown {
  structure: number;
  volume: number;
  trend: number;
  htf: number;
  rr: number;
  liquidity: number;
  risk: number;
  total: number;
}

export interface ScannerSignal {
  id: string;
  scannerSlug: ScannerSlug;
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  stage: SignalStage;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  entryPrice: number;
  invalidationPrice: number;
  tp1Price: number;
  tp2Price: number | null;
  rrRatio: number;
  rsiValue: number;
  rvolValue: number;
  reasons: string[];
  isMonitoringTag: boolean;
  createdAt: number;
  validUntil: number;
}

/* -------------------------------------------------------------------------- */
/* MARKET DATA                                                                */
/* -------------------------------------------------------------------------- */

export type ObStatus = 'NONE' | 'DEMAND_BUY' | 'SUPPLY_WAIT';
export type EmaStatus = 'NONE' | 'GOLDEN_9_21' | 'DEATH_9_21' | 'SNIPER_BUY' | 'SNIPER_SELL';

export interface CoinSnapshot {
  symbol: string;
  baseAsset: string;
  enabled: boolean;
  hasPerpetual: boolean;
  isMonitoringTag: boolean;

  price: number;
  changePct24h: number;
  quoteVol24h: number;
  high24h: number;
  low24h: number;
  spreadPct: number;
  fundingRatePct: number | null;

  rsi: number;
  rsiPrev: number;
  rsiDelta: number;
  rvol: number;
  atr: number;
  atrPct: number;

  ema9: number;
  ema13: number;
  ema21: number;
  ema34: number;
  ema50: number;
  alphaSniper: number;
  alphaSniperPrev: number;

  open: number;
  high: number;
  low: number;
  prevClose: number;

  obStatus: ObStatus;
  emaStatus: EmaStatus;

  /** Alpha Sniper rolling 500-candle win rate (null => "WIN RATE: --"). */
  wr500: number | null;
  closedTrades500: number;

  /**
   * §7.3  Score (0–100). The BEST score any scanner awarded this coin on this
   * timeframe during the current cycle, so the Pro Table, Coin Finder and the
   * heatmap show literally the same number as the scanner's signal card.
   * 0 means "no active setup" and surfaces as — in the UI.
   */
  score: number;
}

export type DataMode = 'LIVE' | 'SIMULATED';

export interface MarketSentiment {
  label: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  glyph: string;
  risingPct: number;
  fallingPct: number;
  risingCount: number;
  fallingCount: number;
  totalEnabled: number;
}

export interface TopMover {
  symbol: string;
  baseAsset: string;
  changePct24h: number;
  isMonitoringTag: boolean;
}

export interface Spotlight {
  symbol: string;
  baseAsset: string;
  rsi: number;
  rsiDelta: number;
}

export interface BootStatus {
  phase: 'IDLE' | 'PHASE_A' | 'PHASE_B' | 'READY';
  seeded: number;
  total: number;
  weightUsedMin: number;
  phaseAReady: boolean;
  phaseBReady: boolean;
  /** §2.2  Measured wall-clock seconds for the limit=99 seed (budget: 31s). */
  phaseAElapsedSec: number | null;
  elapsedSec: number;
}

export interface MarketFrame {
  /** Server epoch ms at frame build time. */
  t: number;
  timeframe: Timeframe;
  nextUpdateSec: number;
  cycle: number;
  dataMode: DataMode;
  coins: CoinSnapshot[];
  sentiment: MarketSentiment;
  topMovers: TopMover[];
  spotlight: Spotlight | null;
  counts: {
    total: number;
    enabled: number;
    monitoringTag: number;
    perpetual: number;
    zones: Record<ZoneId, number>;
  };
  boot: BootStatus;
  riskWatchUpdatedAt: number | null;
}

/* -------------------------------------------------------------------------- */
/* WIRE PROTOCOL                                                              */
/* -------------------------------------------------------------------------- */

export type ServerMessage =
  | { type: 'hello'; t: number; dataMode: DataMode; boot: BootStatus; timeframe: Timeframe }
  | { type: 'frame'; frame: MarketFrame }
  /** 1 Hz price/quote tick — only coins whose price moved. */
  | { type: 'tick'; t: number; u: Array<[string, number, number]> }
  | { type: 'signals'; scannerSlug: ScannerSlug; signals: ScannerSignal[] }
  | { type: 'boot'; boot: BootStatus }
  | { type: 'riskwatch'; updatedAt: number }
  | { type: 'access'; entitlements: Record<EntitlementKey, boolean> }
  | { type: 'broadcast'; title: string; body: string; level: BroadcastLevel; severity: BroadcastSeverity; createdAt: number }
  | { type: 'pong'; t: number };

export type ClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; scanners?: ScannerSlug[]; timeframe?: Timeframe }
  | { type: 'unsubscribe'; scanners?: ScannerSlug[] }
  | { type: 'scan-now'; scannerSlug: ScannerSlug };

/* -------------------------------------------------------------------------- */
/* RISK WATCH (spec §8)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * MODULE 6  Manual VIP signal injected by the Admin.
 * Carries its own payload so it can be re-broadcast on reconnect without
 * depending on the scanner engine having produced it.
 */
export interface CustomSignal {
  id: string;
  scannerSlug: ScannerSlug;
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  entryPrice: number;
  invalidationPrice: number;
  tp1Price: number;
  tp2Price: number | null;
  score: number;
  reasons: string[];
  note: string | null;
  createdAt: number;
  /** Admin signals never auto-expire — they stay until explicitly deleted. */
  validUntil: number | null;
  createdBy: string;
}

export type RiskCategory = 'MONITORING_TAG' | 'DELISTING_NOTICE' | 'SPOT_NEWS';

export interface RiskWatchItem {
  id: string;
  category: RiskCategory;
  badgeType: 'Monitoring' | 'Notice' | 'Trading Pairs' | 'Delisting';
  symbol: string | null;
  title: string;
  publishedAt: number;
  effectiveDelistDate: number | null;
  sourceUrl: string;
  isPinned: boolean;
}

export interface RiskWatchState {
  items: RiskWatchItem[];
  updatedAt: number;
  nextUpdateSec: number;
  source: 'LIVE_BAPI' | 'CACHED_SNAPSHOT';
  lastError: string | null;
}

/* -------------------------------------------------------------------------- */
/* AUTH / ENTITLEMENTS (spec §12.1)                                           */
/* -------------------------------------------------------------------------- */

export type Role = 'USER' | 'ADMIN';
export type PlanTier = 'LITE' | 'ULTRA_PRO';

export interface Entitlements extends Record<EntitlementKey, boolean> {}

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  plan: PlanTier;
  whatsappNumber: string | null;
  isSuspended: boolean;
  entitlements: Entitlements;
  licenseKey: string | null;
  licenseExpiresAt: number | null;
  preferredTimeframe: Timeframe;
  tileDensity: 'COMPACT' | 'COMFORTABLE';
  soundEnabled: boolean;
  chartMode: 'EXTERNAL_TV' | 'INTERNAL';
  timezonePref: string;
  watchlistSymbols: string[];
  acceptedDisclaimerAt: number | null;
}

export interface SystemConfig {
  versionBadge: string;
  loginPageTitle: string;
  loginSubtitle: string;
  brandWatermark: string;
  promoHeadline: string;
  promoTagline: string;
  whatsappContact: string;
  loginCarouselJson: CarouselSlide[] | null;
  /** MODULE 8  Editable product name shown across the terminal chrome. */
  productName: string;
  /** MODULE 8  Pre-filled WhatsApp licence-request message template. */
  whatsappMessageTemplate: string;
  /**
   * MODULE 8  The 12 login feature cards (icon / title / description).
   * Null means "use the built-in factory copy", so a fresh deployment still
   * renders without a seeded config row.
   */
  loginFeaturesJson: LoginFeatureRow[] | null;
  /** MODULE 8  Global broadcast banner pushed to every connected socket. */
  broadcast: BroadcastState | null;
}

export interface LoginFeatureRow {
  id: string;
  title: string;
  body: string;
  icon: string;
}

export type BroadcastSeverity = 'INFO' | 'BULLISH' | 'WARNING' | 'URGENT';

/** Wire-level severity the toast component already understands. */
export type BroadcastLevel = 'info' | 'warn';

export interface BroadcastState {
  title: string;
  message: string;
  severity: BroadcastSeverity;
  createdAt: number;
  createdBy: string;
  /** When the banner stops being served to newly-connecting clients. */
  expiresAt: number | null;
}

export interface CarouselSlide {
  title: string;
  body: string;
}

/* -------------------------------------------------------------------------- */
/* ADMIN PORTAL (spec §10)                                                    */
/* -------------------------------------------------------------------------- */

export interface AdminUserRow {
  id: string;
  username: string;
  role: Role;
  plan: PlanTier;
  whatsappNumber: string | null;
  isSuspended: boolean;
  entitlements: Entitlements;
  licenseKey: string | null;
  licenseExpiresAt: number | null;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface LicenseKeyRow {
  id: string;
  keyString: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  plan: PlanTier;
  durationDays: number;
  maxDevices: number;
  grants: Entitlements;
  assignedUserId: string | null;
  assignedUsername: string | null;
  /** MODULE 3  How many of `maxDevices` are currently registered. */
  devicesUsed?: number;
  activatedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
}

export interface ScannerConfigRow {
  slug: ScannerSlug;
  displayName: string;
  sidebarLabel: string;
  categoryLabel: string;
  subtitle: string;
  enabled: boolean;
  defaultTimeframe: Timeframe;
  scanIntervalSec: number;
  parametersJson: Record<string, number>;
  updatedAt: number;
}

export interface SystemHealth {
  totalUsers: number;
  activeLicenseKeys: number;
  onlineWsClients: number;
  coinsTracked: number;
  phaseAReady: boolean;
  phaseBReady: boolean;
  /** §2.2  Measured wall-clock seconds for the limit=99 seed (budget: 31s). */
  phaseAElapsedSec: number | null;
  binanceWeightUsed: number;
  binanceWeightCap: number;
  wsPool: { streams: number; connections: number; subscriptions: Record<string, number> };
  dataMode: DataMode;
  /** §4.3  Which upstream actually served the last successful call. */
  provider: 'binance' | 'bybit' | 'coincap' | 'NONE';
  /** MODULE 1  Wall-clock ms of the last all-scanner sweep. */
  lastScanDurationMs: number | null;
  /** MODULE 1  Market socket round-trip latency in ms. */
  wsLatencyMs: number | null;
  uptimeSec: number;
  scanCycle: number;
  heapUsedMb: number;
}

export interface AuditLogRow {
  id: string;
  adminUsername: string;
  action: string;
  targetId: string | null;
  createdAt: number;
}
