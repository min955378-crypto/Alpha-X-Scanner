import { NextResponse } from 'next/server';

import { SCANNER_BY_SLUG, type ScannerSlug, type Timeframe } from '@/lib/types';
import { encodeFrame } from '@/lib/wire';
import { getEngine } from '@/server/engine';
import { getDb } from '@/server/engine/db';
import { sessionUserFromToken, SESSION_COOKIE } from '@/server/engine/auth';
import { parseCookies } from '@/server/engine/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * §12.2  GET /api/v1/market/frame?tf=1H
 * HTTP fallback for WebSocket-less clients and for the SSR first paint.
 */
export async function GET(req: Request) {
  const engine = getEngine();
  await engine.start();

  const url = new URL(req.url);
  const tf = (url.searchParams.get('tf') ?? '1H').toUpperCase() as Timeframe;
  const cookies = parseCookies(req.headers.get('cookie'));
  const user = sessionUserFromToken(cookies[SESSION_COOKIE]);

  if (user) engine.requestTimeframe(user.preferredTimeframe);
  engine.requestTimeframe(tf);

  const frame = engine.getFrame(tf) ?? engine.getFrame('1H');
  if (!frame) {
    return NextResponse.json({ ok: false, boot: engine.boot, frame: null }, { status: 202 });
  }

  return NextResponse.json({
    ok: true,
    frame: encodeFrame(frame),
    boot: engine.boot,
    nextUpdateSec: engine.secondsToNextCycle(),
    dataMode: engine.dataMode,
    riskWatchUpdatedAt: engine.riskUpdatedAt,
  });
}

/** Scan-now for a single scanner (§7.1 [🔍 Scan Now]). */
export async function POST(req: Request) {
  const engine = getEngine();
  await engine.start();

  const cookies = parseCookies(req.headers.get('cookie'));
  const user = sessionUserFromToken(cookies[SESSION_COOKIE]);
  if (!user) return NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { scannerSlug?: ScannerSlug };
  const slug = body.scannerSlug;
  if (!slug || !SCANNER_BY_SLUG[slug]) {
    return NextResponse.json({ ok: false, error: 'BAD_SCANNER' }, { status: 400 });
  }
  if (!user.entitlements[SCANNER_BY_SLUG[slug].entitlementKey]) {
    return NextResponse.json({ ok: false, error: 'NOT_ENTITLED' }, { status: 403 });
  }

  const db = getDb();
  const tf = db.scannerConfigs.get(slug)?.defaultTimeframe ?? '1H';
  engine.requestTimeframe(tf);
  const signals = engine.scanNow(slug);
  return NextResponse.json({ ok: true, signals, scannedAt: Date.now() });
}
