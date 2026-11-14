import { NextResponse } from 'next/server';

import { SCANNER_BY_SLUG, TIMEFRAMES, type ScannerSlug, type SignalDirection, type Timeframe } from '@/lib/types';
import { getDb } from '@/server/engine/db';
import { getEngine } from '@/server/engine';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MODULE 6  Manual VIP Signal Injector.
 *
 * Publishes a hand-picked setup straight into a scanner's signal list for
 * every connected terminal. Admin signals are pinned above engine output and
 * never auto-expire, so they stay visible until explicitly deleted.
 */
export async function GET() {
  return NextResponse.json({ ok: true, signals: getDb().listCustomSignals() });
}

async function handlePost(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'publish' | 'delete';
    id?: string;
    scannerSlug?: ScannerSlug;
    symbol?: string;
    timeframe?: Timeframe;
    direction?: SignalDirection;
    entryPrice?: number;
    invalidationPrice?: number;
    tp1Price?: number;
    tp2Price?: number | null;
    score?: number;
    reasons?: string[];
    note?: string | null;
  };

  const db = getDb();

  if (body.action === 'delete') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
    const gone = db.deleteCustomSignal(body.id);
    if (!gone) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
    db.audit(admin.username, 'SIGNAL_DELETE', body.id);
    getEngine().broadcastSignals();
    return NextResponse.json({ ok: true });
  }

  const slug = body.scannerSlug;
  if (!slug || !SCANNER_BY_SLUG[slug]) {
    return NextResponse.json({ ok: false, error: 'BAD_SCANNER' }, { status: 400 });
  }

  const symbol = (body.symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) {
    return NextResponse.json({ ok: false, error: 'BAD_SYMBOL' }, { status: 400 });
  }

  const timeframe = body.timeframe && TIMEFRAMES.includes(body.timeframe) ? body.timeframe : '1H';
  const direction: SignalDirection = body.direction === 'SHORT' ? 'SHORT' : 'LONG';

  const entryPrice = Number(body.entryPrice);
  const invalidationPrice = Number(body.invalidationPrice);
  const tp1Price = Number(body.tp1Price);
  const tp2Raw = body.tp2Price === null || body.tp2Price === undefined ? null : Number(body.tp2Price);
  const tp2Price = tp2Raw !== null && Number.isFinite(tp2Raw) ? tp2Raw : null;

  for (const v of [entryPrice, invalidationPrice, tp1Price]) {
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ ok: false, error: 'BAD_PRICE' }, { status: 400 });
    }
  }

  /* Sanity-check the geometry so a typo cannot publish a signal whose TP is
     on the wrong side of entry. */
  if (direction === 'LONG' && (invalidationPrice >= entryPrice || tp1Price <= entryPrice)) {
    return NextResponse.json({ ok: false, error: 'BAD_LONG_GEOMETRY' }, { status: 400 });
  }
  if (direction === 'SHORT' && (invalidationPrice <= entryPrice || tp1Price >= entryPrice)) {
    return NextResponse.json({ ok: false, error: 'BAD_SHORT_GEOMETRY' }, { status: 400 });
  }

  const score = Math.max(0, Math.min(100, Math.round(Number(body.score ?? 95))));

  const sig = db.publishCustomSignal({
    scannerSlug: slug,
    symbol,
    baseAsset: symbol.replace(/USDT$/, ''),
    timeframe,
    direction,
    entryPrice,
    invalidationPrice,
    tp1Price,
    tp2Price,
    score,
    reasons: Array.isArray(body.reasons) ? body.reasons.filter((r) => typeof r === 'string').slice(0, 12) : [],
    note: body.note ?? null,
    createdBy: admin.username,
  });

  db.audit(admin.username, `SIGNAL_PUBLISH ${direction} ${symbol} @${entryPrice}`, sig.id);
  getEngine().broadcastSignals();

  return NextResponse.json({ ok: true, signal: sig });
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}
