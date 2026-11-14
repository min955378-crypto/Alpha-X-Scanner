import { NextResponse } from 'next/server';

import { getEngine } from '@/server/engine';
import { getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 4 — Coin universe & Monitoring Tag (⚠) overrides. */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    symbol?: string;
    enabled?: boolean;
    isMonitoringTag?: boolean;
  };

  if (!body.symbol) return NextResponse.json({ ok: false, error: 'MISSING_SYMBOL' }, { status: 400 });

  const engine = getEngine();
  const coin = engine.store.get(body.symbol);
  if (!coin) return NextResponse.json({ ok: false, error: 'COIN_NOT_FOUND' }, { status: 404 });

  if (typeof body.enabled === 'boolean') coin.enabled = body.enabled;
  if (typeof body.isMonitoringTag === 'boolean') {
    coin.isMonitoringTag = body.isMonitoringTag;
    coin.manualTagOverride = true;
  }

  const db = getDb();
  db.audit(admin.username, 'COIN_UPDATE', body.symbol);

  return NextResponse.json({
    ok: true,
    coin: {
      symbol: coin.entry.symbol,
      enabled: coin.enabled,
      isMonitoringTag: coin.isMonitoringTag,
      manualTagOverride: coin.manualTagOverride,
    },
  });
}
