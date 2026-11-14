import { NextResponse } from 'next/server';

import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { getEngine } from '@/server/engine';
import { fetchKlines } from '@/server/engine/binance';
import { parseCookies, sessionUserFromToken, SESSION_COOKIE } from '@/server/engine/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * §4.4  GET /api/market/klines?symbol=BTCUSDT&tf=1H&limit=500
 *
 * Candle history for the Alpha X Native Sniper Chart.
 *
 * The engine already holds 500 candles per symbol per timeframe after Phase B,
 * so in the steady state this is a pure memory read — zero REST weight and no
 * extra latency. If the symbol/timeframe has not been backfilled yet we fall
 * back to a live upstream fetch (Binance mirror → Bybit) so the chart still
 * renders immediately rather than showing an empty canvas.
 */
export async function GET(req: Request) {
  const engine = getEngine();
  await engine.start();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase();
  const tf = (url.searchParams.get('tf') ?? '1H').toUpperCase() as Timeframe;
  const limitRaw = Number(url.searchParams.get('limit') ?? 500);
  const limit = Math.max(50, Math.min(500, Number.isFinite(limitRaw) ? Math.round(limitRaw) : 500));

  if (!symbol) {
    return NextResponse.json({ ok: false, error: 'BAD_SYMBOL' }, { status: 400 });
  }
  if (!(TIMEFRAMES as readonly string[]).includes(tf)) {
    return NextResponse.json({ ok: false, error: 'BAD_TIMEFRAME' }, { status: 400 });
  }

  /* A valid session is required — this endpoint exposes market history. */
  const cookies = parseCookies(req.headers.get('cookie'));
  const user = sessionUserFromToken(cookies[SESSION_COOKIE]);
  if (!user) return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });

  engine.requestTimeframe(tf);

  const fromStore = engine.store.candles(symbol, tf);
  if (fromStore && fromStore.length >= 50) {
    return NextResponse.json({
      ok: true,
      symbol,
      tf,
      candles: fromStore.slice(-limit),
      source: 'engine',
      dataMode: engine.dataMode,
    });
  }

  /* Not backfilled yet — go to the upstream rather than returning an empty chart. */
  const live = await fetchKlines(symbol, tf, limit);
  if (live && live.length) {
    return NextResponse.json({
      ok: true,
      symbol,
      tf,
      candles: live,
      source: 'upstream',
      dataMode: engine.dataMode,
    });
  }

  return NextResponse.json(
    { ok: false, error: 'NO_DATA', symbol, tf, dataMode: engine.dataMode },
    { status: 404 },
  );
}
