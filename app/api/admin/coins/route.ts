import { NextResponse } from 'next/server';

import { getEngine } from '@/server/engine';
import { getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 4 — Coin universe & Monitoring Tag (⚠) overrides. */
async function handlePost(req: Request) {
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

  /* Persist the override so it survives a restart and travels in a backup —
     the engine store is in-memory only. */
  const db = getDb();
  const saved = db.setCoinOverride(coin.entry.symbol, {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    isMonitoringTag: typeof body.isMonitoringTag === 'boolean' ? body.isMonitoringTag : undefined,
  });
  db.audit(admin.username, 'COIN_UPDATE', body.symbol);

  return NextResponse.json({
    ok: true,
    coin: {
      symbol: saved.symbol,
      enabled: saved.enabled,
      isMonitoringTag: saved.isMonitoringTag,
      manualTagOverride: saved.manualTagOverride,
    },
  });
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}
