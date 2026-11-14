import type { CarouselSlide, SystemConfig, Timeframe } from './types';

/* -------------------------------------------------------------------------- */
/* §1.1  PRODUCT IDENTITY — [LIVE-VERIFIED] facts. Do not alter.              */
/* -------------------------------------------------------------------------- */

export const BRAND = {
  productName: 'Alpha X Scanner',
  domain: 'https://alpha-x-scanner.com',
  loginTitle: 'Alpha X Scanner — Institutional Crypto Terminal',
  loginSubtitle: 'Smart Binance Coin Finder',
  brandWatermark: 'Muhammad Ibrahim',
  promoHeadline: 'Muhammad Ibrahim',
  promoTagline: 'Protect your capital and let quality setups come to you.',
  whatsappContact: '0348-5581969',
  /** §1.3  Single canonical WhatsApp deep link — pre-filled purchase request. */
  whatsappHref:
    'https://wa.me/923485581969?text=Assalam-o-Alaikum%20Muhammad%20Ibrahim!%20I%20visited%20Alpha%20X%20Scanner%20and%20want%20to%20purchase%20a%20License%20Key%20for%20Alpha%20X%20Pro%20access.%20Please%20share%20the%20details.',
  defaultVersionBadge: 'v2.5 Pro',
} as const;

/** §1.2  Verbatim legal disclosures — rendered on every page footer. */
export const LEGAL_EN =
  'Alpha X Scanner is an independent educational tool created by Muhammad Ibrahim. Educational purpose only — this is not financial advice. Crypto trading carries a substantial risk of loss, and no scanner, indicator, or signal guarantees a profit. Monitoring Tag is a risk warning, not confirmation of delisting. Always open the official Binance notice before making a decision.';

/** §3.2  The 12 platform capabilities shown on the login gate — verbatim copy. */
export interface LoginFeature {
  id: string;
  title: string;
  body: string;
  /** Icon key from components/ui/Icons. */
  icon: 'search' | 'layers' | 'spark' | 'bolt' | 'blocks' | 'trending' | 'hidden' | 'crosshair' | 'shieldAlert' | 'activity' | 'candles' | 'volume';
}

export const LOGIN_FEATURES: LoginFeature[] = [
  {
    id: 'scanner',
    title: 'Smart Binance USDT Coin Scanner',
    body: 'Real-time institutional scanning across 600+ Binance USDT spot pairs on a single unified terminal.',
    icon: 'search',
  },
  {
    id: 'heatmap',
    title: 'Live 6-Zone RSI Heatmap',
    body: 'Instant visual categorization from 10–20 Extreme and 20–30 Oversold up to 50–60 V1 Zone and 60+ Gainers.',
    icon: 'layers',
  },
  {
    id: 'spotlight',
    title: 'RSI 52–55 Rising Momentum Spotlight',
    body: 'Automatically isolates the strongest accelerating coin inside the RSI 52–55 sweet spot every 60 seconds.',
    icon: 'spark',
  },
  {
    id: 'v1',
    title: 'V1 Scaling Momentum Scanner',
    body: 'High-RVOL breakout and momentum continuation screening in the RSI 50–60 zone.',
    icon: 'bolt',
  },
  {
    id: 'order-block',
    title: 'Institutional Order Block Scanner',
    body: 'Detects unmitigated Bullish Demand and Bearish Supply order blocks with BOS & FVG validation.',
    icon: 'blocks',
  },
  {
    id: 'ema',
    title: 'EMA Crossover & Pullback Scanner',
    body: 'Tracks fast/slow EMA stack alignment, fresh crossovers, and dynamic trend pullback re-entries.',
    icon: 'trending',
  },
  {
    id: 'hidden-bull',
    title: 'Hidden Bullish & ICT Scanner',
    body: '3-stage confirmation pipeline (Potential → Waiting → BUY) inside the RSI 30–40 zone.',
    icon: 'hidden',
  },
  {
    id: 'sniper',
    title: 'Alpha Sniper & 500-Candle Backtester',
    body: 'Custom 30–70 oscillator channel paired with a live rolling 500-candle win-rate engine.',
    icon: 'crosshair',
  },
  {
    id: 'risk',
    title: 'Binance Risk Watch Safety Center',
    body: 'Tracks Monitoring Tag (⚠) coins, Upcoming Delisting Notices, and Binance Spot News hourly.',
    icon: 'shieldAlert',
  },
  {
    id: 'sentiment',
    title: '24h Market Sentiment & Top Movers',
    body: 'Live Bullish / Neutral / Bearish market breadth gauge and top 5 surging gainers.',
    icon: 'activity',
  },
  {
    id: 'tradingview',
    title: 'Multi-Timeframe TradingView Handoff',
    body: 'One-click deep-linking to Binance charts synced to your 15M / 30M / 1H / 4H / 1D setting.',
    icon: 'candles',
  },
  {
    id: 'alerts',
    title: 'Real-Time Audio Alerts & Signal Logs',
    body: 'Precision sound chimes and live execution logs the moment setups hit entry confirmation.',
    icon: 'volume',
  },
];

/**
 * §4.2  12-slide login carousel.
 * Slide 1 is [LIVE-VERIFIED]; slides 2-12 are [PROPOSED] and live in
 * SystemConfig.loginCarouselJson so the Admin portal can edit the copy.
 */
export const LOGIN_CAROUSEL: CarouselSlide[] = [
  {
    title: '🔍Smart Binance USDT Coin Scanner',
    body: 'Real-time scanning across 600+ Binance USDT spot pairs on a single unified terminal.',
  },
  { title: '📊 Live 6-Zone RSI Heatmap', body: 'Instant visual categorization from 10-20 Extreme and 20-30 Oversold up to 50-60 V1 Zone and 60+ Gainers.' },
  { title: '🟧 RSI 52–55 Rising Momentum Spotlight', body: 'Automatically highlights the strongest accelerating coin inside the RSI 52–55 sweet spot every 60 seconds.' },
  { title: '⚡ V1 Scaling (V1 Scalping) Scanner', body: 'Momentum continuation screening for high-RVOL breakouts in the RSI 50–60 zone.' },
  { title: '🟩 Institutional Order Block Scanner', body: 'Detects unmitigated Bullish Demand and Bearish Supply order blocks with BOS & FVG validation.' },
  { title: '📈 EMA Crossover & Pullback Scanner', body: 'Tracks fast/slow EMA alignment, fresh crossovers, and dynamic trend pullback re-entries.' },
  { title: '🔵 Hidden Bullish & ICT Scanner', body: '3-stage confirmation pipeline (Potential → Waiting → BUY) inside the RSI 30–40 zone.' },
  { title: '🎯 Alpha Sniper & 500-Candle Backtester', body: 'Custom 30–70 purple channel oscillator paired with a rolling 500-candle win-rate overlay.' },
  { title: '⚠ Binance Risk Watch Safety Center', body: 'Tracks Monitoring Tag (⚠) coins, Upcoming Delisting Notices, and Binance Spot News hourly.' },
  { title: '🧭 24h Market Sentiment & Top Movers', body: 'Live Bullish / Neutral / Bearish breadth ratio and top 5 surging gainers.' },
  { title: '🕒 Multi-Timeframe TradingView Handoff', body: 'One-click deep-linking to Binance charts synced to your 15M / 30M / 1H / 4H / 1D setting.' },
  { title: '🔔 Real-Time Audio Alerts & Signal Logs', body: 'Browser sound chimes and live execution logs when setups reach entry confirmation.' },
];

/**
 * MODULE 8  Pre-filled WhatsApp licence-request template.
 * `{PRODUCT}`, `{OWNER}` and `{WHATSAPP}` are substituted server-side so the
 * owner can rebrand without editing three different places.
 */
export const DEFAULT_WHATSAPP_TEMPLATE = [
  'Assalam-o-Alaikum! I would like to request an *Alpha X Scanner Pro* license.',
  '',
  '👤 Name:',
  '🏙 City:',
  '📦 Plan Interested In:',
  '',
  'Looking forward to hearing from you.',
].join('\n');

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  versionBadge: BRAND.defaultVersionBadge,
  loginPageTitle: BRAND.loginTitle,
  loginSubtitle: BRAND.loginSubtitle,
  brandWatermark: BRAND.brandWatermark,
  promoHeadline: BRAND.promoHeadline,
  promoTagline: BRAND.promoTagline,
  whatsappContact: BRAND.whatsappContact,
  loginCarouselJson: LOGIN_CAROUSEL,
  productName: BRAND.productName,
  whatsappMessageTemplate: DEFAULT_WHATSAPP_TEMPLATE,
  loginFeaturesJson: LOGIN_FEATURES.map((f) => ({ id: f.id, title: f.title, body: f.body, icon: f.icon })),
  broadcast: null,
};

/**
 * §6.3  [SEEN IN VIDEO] — the 34 coins carrying a Binance Monitoring Tag.
 * These override their zone tile colour with the olive/khaki-gold palette.
 */
export const MONITORING_TAG_SYMBOLS: string[] = [
  'ACT', 'ARK', 'AVA', 'AWE', 'BICO', 'BLUR', 'COOKIE', 'CVC', 'DODO', 'FTT', 'GLMR', 'GNS',
  'GTC', 'HEI', 'JASMY', 'LSK', 'MOVE', 'MOVR', 'NOM', 'PORTAL', 'QKC', 'QUICK', 'RARE',
  'RESOLV', 'SCR', 'SOPH', 'STX', 'SYN', 'TLM', 'TOWNS', 'VELODROME', 'WIF', 'ZEC', 'ZEN',
];

/**
 * §1.1  Market universe excludes leveraged tokens.
 * Any pair whose base asset ends in these suffixes is never tracked.
 */
export const LEVERAGED_TOKEN_SUFFIXES = ['UP', 'DOWN', 'BULL', 'BEAR'] as const;

export function isLeveragedToken(baseAsset: string): boolean {
  return LEVERAGED_TOKEN_SUFFIXES.some((s) => baseAsset.endsWith(s));
}

/** §9.1  TradingView deep-link builder. */
export function tradingViewUrl(baseAsset: string, timeframe: Timeframe, intervalMap: Record<Timeframe, string>): string {
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT&interval=${intervalMap[timeframe]}`;
}

/**
 * §6.2  Institutional Trading Glossary — searchable, English only.
 * The Urdu column was retired with the legacy brand purge (§1.1).
 */
export const GLOSSARY: Array<{ term: string; en: string }> = [
  { term: 'RSI Heatmap', en: 'A colour-coded grid of every coin\u2019s 14-period RSI, refreshed every 60 seconds.' },
  { term: 'V1 Zone (50-60)', en: 'The RSI 50\u201360 band where momentum continuation (V1 scaling) setups are hunted.' },
  { term: 'RSI 52-55 Rising', en: 'The sweet spot: RSI rising inside 52\u201355 with positive 24h change. Spotlighted live.' },
  { term: 'Hidden Bullish Divergence', en: 'Price prints a higher low while RSI prints a lower low \u2014 a continuation signal in RSI 30\u201340.' },
  { term: 'Order Block (Demand/Supply)', en: 'The last opposing candle before an impulsive move; institutions defend it on the retest.' },
  { term: 'Mitigation', en: 'Price returning into an order block and consuming the resting orders inside it.' },
  { term: 'Break of Structure (BOS)', en: 'A candle closing beyond a prior swing high/low, confirming displacement.' },
  { term: 'Fair Value Gap (FVG)', en: 'A 3-candle imbalance left by displacement; price tends to rebalance into it.' },
  { term: 'RVOL(20)', en: 'Relative volume: current bar volume (time-normalised) divided by the 20-bar average.' },
  { term: 'Alpha Sniper', en: 'EMA(RSI(14), 3) plotted in a 30\u201370 purple channel; crosses of 30/50/70 are the triggers.' },
  { term: 'Monitoring Tag (\u26a0)', en: 'A Binance risk warning on higher-volatility assets. It is NOT a delisting confirmation.' },
  { term: 'EMA Ribbon (9/21/50)', en: 'Three stacked exponential moving averages; compression then expansion marks trend ignition.' },
  { term: 'Liquidity Sweep', en: 'A fast move through a swing low/high that grabs resting stops before reversing.' },
  { term: 'Risk\u2013Reward (R:R)', en: 'Distance to TP1 divided by distance to the stop. Alpha X targets a minimum of 1.5R.' },
  { term: 'Win Rate (500)', en: 'Rolling backtest accuracy of a setup across the last 500 candles on the active timeframe.' },
];

/** §3.2  Density scale. */
export const DENSITY = {
  COMFORTABLE: { tileW: 86, tileH: 36, symbol: 12, sub: 10 },
  COMPACT: { tileW: 66, tileH: 28, symbol: 10, sub: 8 },
} as const;
