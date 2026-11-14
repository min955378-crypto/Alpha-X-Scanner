import { NextResponse } from 'next/server';

import { getEngine } from '@/server/engine';
import { refreshRiskWatch } from '@/server/engine/riskwatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §8  GET the three Risk Watch columns. */
export async function GET() {
  const engine = getEngine();
  await engine.start();
  const items = engine.getRiskItems();

  return NextResponse.json({
    ok: true,
    items,
    updatedAt: engine.riskUpdatedAt,
    nextUpdateSec: Math.max(0, Math.round((engine.riskNextAt - Date.now()) / 1000)),
    lastError: engine.riskError,
  });
}

/**
 * §8.1  Manual refresh. Admin-only, protected server-side by a 60s mutex so a
 * stampede of clicks cannot hammer the Binance BAPI.
 */
export async function POST(req: Request) {
  const engine = getEngine();
  await engine.start();

  const since = Date.now() - engine.riskUpdatedAt!;
  const locked = engine.riskUpdatedAt !== null && since < 60_000;
  if (locked) {
    return NextResponse.json(
      { ok: false, error: 'RATE_LIMITED', retryAfterSec: Math.ceil((60_000 - since) / 1000) },
      { status: 429 },
    );
  }

  const res = await refreshRiskWatch();
  return NextResponse.json({
    ok: res.ok,
    source: res.source,
    upserted: res.upserted,
    error: res.error,
    updatedAt: engine.riskUpdatedAt,
  });
}
