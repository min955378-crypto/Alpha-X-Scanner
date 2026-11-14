import { randomUUID } from 'node:crypto';

import { MONITORING_TAG_SYMBOLS } from '@/lib/constants';
import type { RiskWatchItem } from '@/lib/types';
import { getDb } from './db';

/**
 * §8.3  Binance Risk Watch — live, unauthenticated BAPI CMS pipeline.
 *
 * Binance exposes its announcement catalogs as public JSON; no headless
 * browser and no API key is required:
 *
 *   Delistings      catalogId=161
 *   New listings    catalogId=48
 *
 * Four production gotchas are handled explicitly below (see the comments at
 * each numbered step), and a failed sync NEVER blanks the database — the
 * @@unique([sourceUrl]) upsert is non-destructive (§8.3 gotcha #4).
 */

const CMS_BASE = 'https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query';
const ANNOUNCEMENT_BASE = 'https://www.binance.com/en/support/announcement/';
const DELISTING_CATALOG = 161;
const SPOT_NEWS_CATALOG = 48;
const TIMEOUT_MS = 7000;

interface CmsArticle {
  id: number;
  code: string;
  title: string;
  type: number;
  releaseDate: number | null;
  publishDate: number | null;
}

/* --------------------------- bundled snapshot ----------------------------- */

/**
 * [SEEN IN VIDEO] + [LIVE-VERIFIED IN BINANCE CMS] — the exact rows visible in
 * the 11m38s dashboard recording. Used as the cold-start snapshot whenever the
 * live BAPI is unreachable.
 */
const BUNDLED_NOTICES: Array<{ title: string; published: string }> = [
  { title: 'Notice of Removal of Spot Trading Pairs - 2026-10-23', published: '2026-10-20' },
  { title: 'Binance Will Delist EPIC, QUICK on 2026-10-28', published: '2026-10-21' },
  { title: 'Notice of Removal of Spot Trading Pairs - 2026-10-02', published: '2026-09-29' },
  { title: 'Notice of Removal of Spot Trading Pairs - 2026-09-25', published: '2026-09-22' },
  { title: 'Notice of Removal of Spot Trading Pairs - 2026-09-18', published: '2026-09-15' },
  { title: 'Binance Will Delist USDP on 2026-09-24', published: '2026-09-17' },
  { title: 'Notice of Removal of Spot Trading Pairs - 2026-09-11', published: '2026-09-08' },
];

const BUNDLED_NEWS: Array<{ title: string; published: string; badge: 'Trading Pairs' | 'Delisting' }> = [
  { title: 'Notice on New Trading Pairs & Trading Bots Services on Binance Spot - 2026-10-28', published: '2026-10-28', badge: 'Trading Pairs' },
  { title: 'Binance Alpha Will Remove PTB, AA, OWL, DORA, ELIZAOS, MEMES... (2026-10-23)', published: '2026-10-23', badge: 'Delisting' },
  { title: 'Binance Futures Will Delist PTBUSDT and MITOUSDT USDⓈ-M Perpetual Contracts (2026-10-23)', published: '2026-10-23', badge: 'Delisting' },
  { title: 'Binance Exchange Adds RoboStrategy Inc (BOTB), Berkshire Hathaway (BRKBB), KraneShares STAR Market 50 ETF (KSTRB), Direxion Daily 20 Year Treasury Bull 3X ETF (TMFB) and Vistra Corp (VSTB) bStocks Trading Pairs on Binance Spot/Convert - 2026-10-21', published: '2026-10-21', badge: 'Trading Pairs' },
  { title: 'Notice of Removal of Spot Trading Pairs - 2026-10-23', published: '2026-10-23', badge: 'Delisting' },
  { title: 'Binance Will Delist EPIC, QUICK on 2026-10-28', published: '2026-10-21', badge: 'Delisting' },
];

function ms(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

function bundledSnapshot(): RiskWatchItem[] {
  const out: RiskWatchItem[] = [];

  for (const base of MONITORING_TAG_SYMBOLS) {
    out.push({
      id: randomUUID(),
      category: 'MONITORING_TAG',
      badgeType: 'Monitoring',
      symbol: base,
      title: base,
      publishedAt: ms('2026-10-28'),
      effectiveDelistDate: null,
      sourceUrl: `https://www.binance.com/en/trade/${base}USDT?type=spot`,
      isPinned: false,
    });
  }

  for (const [i, n] of BUNDLED_NOTICES.entries()) {
    const code = `bundled-notice-${i + 1}`;
    const dateMatch = n.title.match(/(\d{4}-\d{2}-\d{2})/);
    out.push({
      id: randomUUID(),
      category: 'DELISTING_NOTICE',
      badgeType: dateMatch && dateMatch[1] > new Date().toISOString().slice(0, 10) ? 'Notice' : 'Notice',
      symbol: extractSymbols(n.title),
      title: n.title,
      publishedAt: ms(n.published),
      effectiveDelistDate: dateMatch ? ms(dateMatch[1]) : null,
      sourceUrl: `${ANNOUNCEMENT_BASE}${code}`,
      isPinned: false,
    });
  }

  for (const [i, n] of BUNDLED_NEWS.entries()) {
    const dateMatch = n.title.match(/(\d{4}-\d{2}-\d{2})/);
    out.push({
      id: randomUUID(),
      category: 'SPOT_NEWS',
      badgeType: n.badge,
      symbol: extractSymbols(n.title),
      title: n.title,
      publishedAt: ms(n.published),
      effectiveDelistDate: n.badge === 'Delisting' && dateMatch ? ms(dateMatch[1]) : null,
      sourceUrl: `${ANNOUNCEMENT_BASE}bundled-news-${i + 1}`,
      isPinned: false,
    });
  }

  return out;
}

/** Pull explicit ALL-CAPS tickers out of an announcement title. */
function extractSymbols(title: string): string | null {
  const m = title.match(/\b[A-Z0-9]{2,12}(?:,\s*[A-Z0-9]{2,12})*\b/g);
  if (!m) return null;
  const stop = new Set(['BINANCE', 'WILL', 'DELIST', 'NOTICE', 'OF', 'REMOVAL', 'SPOT', 'TRADING', 'PAIRS', 'ON', 'AND', 'THE', 'USD', 'USDT', 'ALPHA', 'FUTURES', 'ADD', 'ADDS', 'CONVERT', 'PERPETUAL', 'CONTRACTS', 'SERVICES', 'BOTS', 'NEW', 'REMOVE', 'INC', 'ETF']);
  const found = m
    .flatMap((chunk) => chunk.split(',').map((s) => s.trim()))
    .filter((s) => /^[A-Z0-9]{2,10}$/.test(s) && !stop.has(s) && !/^\d+$/.test(s));
  return found.length ? found.slice(0, 4).join(',') : null;
}

/* ----------------------------- live BAPI sync ----------------------------- */

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'ScalpPro/2.0 (+https://scalp-usdt.com)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseArticles(payload: unknown): CmsArticle[] {
  const root = payload as { data?: { catalogs?: Array<{ articles?: CmsArticle[] }> } };
  const catalogs = root?.data?.catalogs;
  if (!Array.isArray(catalogs) || catalogs.length === 0) return [];
  const articles = catalogs[0]?.articles;
  return Array.isArray(articles) ? articles : [];
}

/**
 * GOTCHA #2 — `pageSize` is clamped server-side. Never assume pageSize=100
 * returns 100 rows; iterate pageNo 1..2 for deeper history.
 */
async function fetchCatalog(catalogId: number, pages = 2): Promise<CmsArticle[]> {
  const out: CmsArticle[] = [];
  for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
    const url = `${CMS_BASE}?type=1&catalogId=${catalogId}&pageNo=${pageNo}&pageSize=20`;
    const articles = parseArticles(await fetchJson(url));
    if (articles.length === 0) break;
    out.push(...articles);
  }
  return out;
}

/** GOTCHA #1 — `publishDate` is null in list responses; use `releaseDate`. */
function articlePublishedAt(a: CmsArticle): number {
  if (typeof a.releaseDate === 'number' && a.releaseDate > 0) return a.releaseDate;
  if (typeof a.publishDate === 'number' && a.publishDate > 0) return a.publishDate;
  const m = a.title.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? ms(m[1]) : Date.now();
}

/** GOTCHA #1 (cont.) — parse the effective date straight out of the title. */
function articleEffectiveDate(a: CmsArticle): number | null {
  const m = a.title.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? ms(m[1]) : null;
}

/**
 * GOTCHA #3 — `body` is null in list responses. For generic titles such as
 * "Notice of Removal of Spot Trading Pairs - 2026-10-23" the affected tickers
 * live in the article body, so fetch the detail page once and cache it.
 */
const detailCache = new Map<string, { at: number; symbols: string | null }>();
const DETAIL_TTL = 6 * 60 * 60 * 1000;

async function fetchArticleSymbols(code: string, title: string): Promise<string | null> {
  const cached = detailCache.get(code);
  if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.symbols;

  const fromTitle = extractSymbols(title);
  let symbols: string | null = fromTitle;

  try {
    const html = (await fetchJson(`${CMS_BASE.replace('/list/query', '/detail/query')}?articleCode=${code}`)) as {
      data?: { body?: string | null };
    };
    const body = html?.data?.body;
    if (typeof body === 'string' && body.length > 0) {
      const text = body.replace(/<[^>]+>/g, ' ');
      const tickers = text.match(/\b([A-Z0-9]{2,10})\/USDT\b/g);
      if (tickers && tickers.length) {
        symbols = [...new Set(tickers.map((t) => t.split('/')[0]))].slice(0, 12).join(',');
      }
    }
  } catch {
    /* Detail fetch is best-effort — the title-derived symbols still stand. */
  }

  detailCache.set(code, { at: Date.now(), symbols });
  return symbols;
}

function classify(title: string): 'Trading Pairs' | 'Delisting' {
  return /delist|removal|remove|will delist/i.test(title) ? 'Delisting' : 'Trading Pairs';
}

/* ------------------------------- public API ------------------------------- */

export interface RiskWatchSyncResult {
  ok: boolean;
  source: 'LIVE_BAPI' | 'CACHED_SNAPSHOT';
  upserted: number;
  error: string | null;
}

export async function refreshRiskWatch(): Promise<RiskWatchSyncResult> {
  const db = getDb();

  try {
    const [delistings, news] = await Promise.all([
      fetchCatalog(DELISTING_CATALOG),
      fetchCatalog(SPOT_NEWS_CATALOG),
    ]);

    if (delistings.length === 0 && news.length === 0) {
      throw new Error('empty catalog response');
    }

    // GOTCHA #4 — upsert, never replace. Existing rows survive a partial sync.
    let upserted = 0;

    for (const a of delistings) {
      if (!a?.code) continue;
      const sourceUrl = `${ANNOUNCEMENT_BASE}${a.code}`;
      const existing = db.riskItemByUrl(sourceUrl);
      const symbol = extractSymbols(a.title) ?? (await fetchArticleSymbols(a.code, a.title));
      const item: RiskWatchItem = {
        id: existing?.id ?? randomUUID(),
        category: 'DELISTING_NOTICE',
        badgeType: 'Notice',
        symbol,
        title: a.title,
        publishedAt: articlePublishedAt(a),
        effectiveDelistDate: articleEffectiveDate(a),
        sourceUrl,
        isPinned: existing?.isPinned ?? false,
      };
      db.upsertRiskItem(item);
      upserted += 1;
    }

    for (const a of news) {
      if (!a?.code) continue;
      const sourceUrl = `${ANNOUNCEMENT_BASE}${a.code}`;
      const existing = db.riskItemByUrl(sourceUrl);
      const item: RiskWatchItem = {
        id: existing?.id ?? randomUUID(),
        category: 'SPOT_NEWS',
        badgeType: classify(a.title),
        symbol: extractSymbols(a.title),
        title: a.title,
        publishedAt: articlePublishedAt(a),
        effectiveDelistDate: articleEffectiveDate(a),
        sourceUrl,
        isPinned: existing?.isPinned ?? false,
      };
      db.upsertRiskItem(item);
      upserted += 1;
    }

    // Monitoring Tag rows are curated (Admin-overridable), never CMS-derived.
    ensureMonitoringRows();
    db.persist();
    return { ok: true, source: 'LIVE_BAPI', upserted, error: null };
  } catch (err) {
    // GOTCHA #4 — preserve existing rows untouched and log a warning.
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[risk-watch] BAPI sync failed (${error}) — preserving existing rows`);
    if (db.riskItems.size === 0) seedSnapshot();
    return { ok: false, source: 'CACHED_SNAPSHOT', upserted: 0, error };
  }
}

function ensureMonitoringRows(): void {
  const db = getDb();
  const present = new Set(
    [...db.riskItems.values()].filter((r) => r.category === 'MONITORING_TAG').map((r) => r.symbol),
  );
  for (const base of MONITORING_TAG_SYMBOLS) {
    if (present.has(base)) continue;
    db.upsertRiskItem({
      id: randomUUID(),
      category: 'MONITORING_TAG',
      badgeType: 'Monitoring',
      symbol: base,
      title: base,
      publishedAt: Date.now(),
      effectiveDelistDate: null,
      sourceUrl: `https://www.binance.com/en/trade/${base}USDT?type=spot`,
      isPinned: false,
    });
  }
}

export function seedSnapshot(): void {
  const db = getDb();
  const existingUrls = new Set([...db.riskItems.values()].map((r) => r.sourceUrl));
  for (const item of bundledSnapshot()) {
    if (existingUrls.has(item.sourceUrl)) continue;
    db.upsertRiskItem(item);
  }
  db.persist();
}

export function listRiskItems(): RiskWatchItem[] {
  const db = getDb();
  return [...db.riskItems.values()].sort((a, b) => b.publishedAt - a.publishedAt);
}
