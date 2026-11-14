import { TF_TO_TV, type Timeframe } from './types';

/* -------------------------------------------------------------------------- */
/* §6.4 (col 4)  Dynamic price precision by magnitude                          */
/* -------------------------------------------------------------------------- */
export function priceDecimals(price: number): number {
  const a = Math.abs(price);
  if (a === 0) return 2;
  if (a < 0.0001) return 8;
  if (a < 0.01) return 6;
  if (a < 1) return 4;
  return 2;
}

export function formatPrice(price: number, overrideDecimals?: number): string {
  const d = overrideDecimals ?? priceDecimals(price);
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Abbreviated quote volume: $1.84B / $42.5M (spec §6.4 col 7). */
export function formatVolume(v: number): string {
  if (!isFinite(v) || v <= 0) return '$0';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function formatFullVolume(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

export function formatPct(pct: number, decimals = 2): string {
  const s = pct.toFixed(decimals);
  return `${pct > 0 ? '+' : ''}${s}%`;
}

export function formatSigned(v: number, decimals = 2): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(decimals)}`;
}

export function formatRsi(rsi: number): string {
  return Number.isFinite(rsi) ? rsi.toFixed(1) : '—';
}

export function formatRvol(rvol: number): string {
  return `${rvol.toFixed(2)}×`;
}

export function formatFunding(rate: number | null): string {
  if (rate === null) return '—';
  return `${rate > 0 ? '+' : ''}${rate.toFixed(3)}%`;
}

/** §5.1  Live clock — 12h with seconds, or 24h. */
export function formatClock(d: Date, tz: string, use24h: boolean): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: !use24h,
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toLocaleTimeString('en-US', { hour12: !use24h });
  }
}

export function formatTimeShort(ms: number, tz: string, use24h: boolean): string {
  return formatClock(new Date(ms), tz, use24h);
}

export function formatDateShort(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      timeZone: tz,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString('en-US');
  }
}

/** mm:ss / h m left style countdowns. */
export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** §7.1  Trade levels are display-trimmed but always copy full precision. */
export function levelCopyValue(v: number): string {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  if (Math.abs(v) >= 1) return String(Number(v.toFixed(4)));
  return String(Number(v.toPrecision(6)));
}

export function tradingViewLink(baseAsset: string, tf: Timeframe): string {
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${baseAsset}USDT&interval=${TF_TO_TV[tf]}`;
}

export function binanceSpotLink(symbol: string): string {
  return `https://www.binance.com/en/trade/${symbol}?type=spot`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
