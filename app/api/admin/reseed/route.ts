import { NextResponse } from 'next/server';

import { getDb } from '@/server/engine/db';
import { getEngine } from '@/server/engine';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MODULE 1  Force Market Reseed.
 *
 * Drops the cached universe and re-runs the exchangeInfo fetch plus the
 * Phase A / Phase B warm-up ladder. The terminal stays live throughout because
 * symbol state is reused for any symbol that still exists.
 */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const engine = getEngine();
  await engine.start();
  const result = await engine.reseed();

  getDb().audit(admin.username, `MARKET_RESEED ${result.mode}`, null);

  return NextResponse.json({ ...result, ok: true });
}
