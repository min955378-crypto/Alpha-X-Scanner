import type { CarouselSlide, SystemConfig, Timeframe } from './types';

/* -------------------------------------------------------------------------- */
/* §1.1  PRODUCT IDENTITY — [LIVE-VERIFIED] facts. Do not alter.              */
/* -------------------------------------------------------------------------- */

export const BRAND = {
  productName: 'ScalpPro',
  domain: 'https://scalp-usdt.com',
  loginTitle: 'ScalpPro v2 — Login',
  loginSubtitle: 'Smart Binance Coin Finder',
  brandWatermark: 'FreedomWthAahad',
  promoHeadline: 'Freedom With Aahad',
  promoTagline: 'Protect your capital and let quality setups come to you.',
  whatsappContact: '+923164404787',
  whatsappHref: 'https://wa.me/923164404787',
  defaultVersionBadge: 'Lite v1.2.8',
} as const;

/** §1.2  Verbatim legal disclosures — rendered on every page footer. */
export const LEGAL_EN =
  'ScalpPro is an independent educational tool created by Freedom With Aahad. It has no official affiliation with, and is not endorsed by, Freedom With Nomi. Educational purpose only — this is not financial advice. Crypto trading carries a substantial risk of loss, and no scanner, indicator, or signal guarantees a profit. Monitoring Tag is a risk warning, not confirmation of delisting. Always open the official Binance notice before making a decision.';

export const LEGAL_UR =
  'یہ ٹول صرف تعلیمی مقصد کے لیے ہے، یہ مالی مشورہ نہیں ہے۔ کرپٹو ٹریڈنگ میں نقصان کا خطرہ ہے۔ کسی بھی سگنل یا اسکینر سے منافع کی ضمانت نہیں۔ ScalpPro ایک خودمختار ٹول ہے جس کا Freedom With Nomi سے کوئی سرکاری تعلق نہیں ہے۔';

/** §1.1 / §11.1  Official FreedomWthAahad tutorial videos — [LIVE-VERIFIED]. */
export const TUTORIALS = [
  {
    id: 'AOtweJ-XWbk',
    title: 'How to Login & Open ScalpPro in Just 2 Clicks Easy Guide',
    duration: '5:01',
    lesson: 'Login & Setup Guide',
    summary:
      'Two-click access walkthrough: enter Username, Password and License Key, then land straight on the live dashboard.',
    summaryUr: 'دو کلک میں لاگ ان: یوزر نیم، پاسورڈ اور لائسنس کی درج کریں اور لائیو ڈیش بورڈ پر پہنچیں۔',
  },
  {
    id: 'pz9-8XH6irE',
    title: 'ScalpPro Website Overview | Crypto Coin Finder & Scanners Explained in Urdu',
    duration: '11:38',
    lesson: 'Lesson 1 — Website Overview',
    summary:
      'Full terminal tour: the 6-zone RSI Heatmap, the 5 scanners, the Pro Table, Coin Finder and the Binance Risk Watch safety centre.',
    summaryUr: 'مکمل ٹور: 6 زون RSI ہیٹ میپ، 5 اسکینرز، پرو ٹیبل، کوائن فائنڈر اور بائننس رسک واچ۔',
  },
  {
    id: 'W8LMwkfrj-Q',
    title: 'ScalpPro Scanner Tutorial | V1, Order Block & EMA Scanners Kaise Use Karein?',
    duration: '6:19',
    lesson: 'Lesson 2 — Scanners Walkthrough',
    summary:
      'How to Start, Stop and Reset each scanner, read the Potential / Waiting / BUY pipeline and copy trade levels.',
    summaryUr: 'ہر اسکینر کو اسٹارٹ، اسٹاپ اور ری سیٹ کرنا، اور پوٹینشل / ویٹنگ / BUY اسٹیج پڑھنا۔',
  },
  {
    id: 'prQuRAIMJME',
    title: 'Order Block Strategy Explained in Urdu | ScalpPro Se Coins Find Aur Chart Analysis',
    duration: '5:09',
    lesson: 'Lesson 3 — Order Block Strategy',
    summary:
      'Finding unmitigated demand and supply order blocks, BOS + FVG validation, and entering on the rejection wick.',
    summaryUr: 'غیر استعمال شدہ ڈیمانڈ اور سپلائی آرڈر بلاکس، BOS اور FVG کی تصدیق، اور ریجیکشن وِک پر انٹری۔',
  },
  {
    id: 'bX-zxQmfW3U',
    title: 'EMA Crossover Strategy Explained in Urdu | ScalpPro Scanner Se Chart Analysis Tak',
    duration: '19:17',
    lesson: 'Lesson 4 — EMA Crossover Strategy',
    summary:
      'EMA 9/21/50 stacking, fresh crossovers, pullback re-entries and how the scanner scores confluence out of 100.',
    summaryUr: 'EMA 9/21/50 اسٹیک، کراس اوور، پل بیک ری انٹری اور 100 میں سے اسکور کا طریقہ۔',
  },
] as const;

/** The two videos linked directly on /login (spec §4.2). */
export const LOGIN_VIDEOS = [TUTORIALS[1], TUTORIALS[0]] as const;

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

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  versionBadge: BRAND.defaultVersionBadge,
  loginPageTitle: BRAND.loginTitle,
  loginSubtitle: BRAND.loginSubtitle,
  brandWatermark: BRAND.brandWatermark,
  promoHeadline: BRAND.promoHeadline,
  promoTagline: BRAND.promoTagline,
  whatsappContact: BRAND.whatsappContact,
  tutorialVideo1Url: `https://www.youtube.com/watch?v=${TUTORIALS[1].id}`,
  tutorialVideo2Url: `https://www.youtube.com/watch?v=${TUTORIALS[0].id}`,
  loginCarouselJson: LOGIN_CAROUSEL,
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

/** §11.1  Bilingual trading glossary (EN + اردو). */
export const GLOSSARY: Array<{ term: string; en: string; ur: string }> = [
  { term: 'RSI Heatmap', en: 'A colour-coded grid of every coin’s 14-period RSI, refreshed every 60 seconds.', ur: 'ہر کوائن کے RSI (14) کا رنگین گرڈ جو ہر 60 سیکنڈ میں ریفریش ہوتا ہے۔' },
  { term: 'V1 Zone (50-60)', en: 'The RSI 50–60 band where momentum continuation (V1 scaling) setups are hunted.', ur: 'RSI 50–60 کی وہ رینج جہاں مومینٹم کنٹینیوایشن سیٹ اپ تلاش کیے جاتے ہیں۔' },
  { term: 'RSI 52-55 Rising', en: 'The sweet spot: RSI rising inside 52–55 with positive 24h change. Spotlighted live.', ur: 'وہ مخصوص جگہ: RSI 52–55 کے درمیان اوپر جا رہا ہو اور 24 گھنٹے کی تبدیلی مثبت ہو۔' },
  { term: 'Hidden Bullish Divergence', en: 'Price prints a higher low while RSI prints a lower low — a continuation signal in RSI 30–40.', ur: 'قیمت نے ہائر لو بنایا مگر RSI نے لوئر لو — RSI 30–40 میں کنٹینیوایشن کا اشارہ۔' },
  { term: 'Order Block (Demand/Supply)', en: 'The last opposing candle before an impulsive move; institutions defend it on the retest.', ur: 'تیز موو سے پہلے والی آخری الٹی کینڈل؛ ادارے دوبارہ ٹیسٹ پر اس کا دفاع کرتے ہیں۔' },
  { term: 'Mitigation', en: 'Price returning into an order block and consuming the resting orders inside it.', ur: 'قیمت کا دوبارہ آرڈر بلاک میں آنا اور وہاں موجود آرڈرز کا استعمال ہو جانا۔' },
  { term: 'Break of Structure (BOS)', en: 'A candle closing beyond a prior swing high/low, confirming displacement.', ur: 'کینڈل کا پچھلے سوئنگ ہائی/لو سے آگے بند ہونا، جو ڈسپلیسمنٹ کی تصدیق ہے۔' },
  { term: 'Fair Value Gap (FVG)', en: 'A 3-candle imbalance left by displacement; price tends to rebalance into it.', ur: 'تیز موو سے بننے والا 3 کینڈل کا خلا؛ قیمت عموماً اسے بھرنے آتی ہے۔' },
  { term: 'RVOL(20)', en: 'Relative volume: current bar volume (time-normalised) divided by the 20-bar average.', ur: 'ریلیٹیو والیوم: موجودہ کینڈل کا والیوم تقسیم 20 کینڈل کے اوسط والیوم پر۔' },
  { term: 'Alpha Sniper', en: 'EMA(RSI(14), 3) plotted in a 30–70 purple channel; crosses of 30/50/70 are the triggers.', ur: 'EMA(RSI(14), 3) جو 30–70 جامنی چینل میں پلاٹ ہوتا ہے؛ 30/50/70 کے کراس ٹرگر ہیں۔' },
  { term: 'Monitoring Tag (⚠)', en: 'A Binance risk warning on higher-volatility assets. It is NOT a delisting confirmation.', ur: 'بائننس کی طرف سے زیادہ اتار چڑھاؤ والے اثاثوں پر خطرے کا نشان۔ یہ ڈی لسٹنگ کی تصدیق نہیں ہے۔' },
];

/** §3.2  Density scale. */
export const DENSITY = {
  COMFORTABLE: { tileW: 86, tileH: 36, symbol: 12, sub: 10 },
  COMPACT: { tileW: 66, tileH: 28, symbol: 10, sub: 8 },
} as const;
