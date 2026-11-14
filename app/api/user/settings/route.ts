import { NextResponse } from 'next/server';

import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { parseCookies, sessionUserFromToken, SESSION_COOKIE } from '@/server/engine/auth';
import { getDb } from '@/server/engine/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * §11.2  Persist the subset of settings that must survive a device change
 * (timeframe, density, sound, chart mode, timezone, watchlist).
 */
export async function POST(req: Request) {
  const user = sessionUserFromToken(parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    preferredTimeframe?: string;
    tileDensity?: string;
    soundEnabled?: boolean;
    chartMode?: string;
    timezonePref?: string;
    watchlistSymbols?: string[];
    savedPresetsJson?: unknown;
  };

  const db = getDb();
  const record = db.userById(user.id);
  if (!record) return NextResponse.json({ ok: false }, { status: 404 });

  if (body.preferredTimeframe && TIMEFRAMES.includes(body.preferredTimeframe as Timeframe)) {
    record.preferredTimeframe = body.preferredTimeframe as Timeframe;
  }
  if (body.tileDensity === 'COMPACT' || body.tileDensity === 'COMFORTABLE') record.tileDensity = body.tileDensity;
  if (typeof body.soundEnabled === 'boolean') record.soundEnabled = body.soundEnabled;
  if (body.chartMode === 'EXTERNAL_TV' || body.chartMode === 'INTERNAL') record.chartMode = body.chartMode;
  if (typeof body.timezonePref === 'string') record.timezonePref = body.timezonePref;
  if (Array.isArray(body.watchlistSymbols)) record.watchlistSymbols = body.watchlistSymbols.slice(0, 500);
  if (body.savedPresetsJson !== undefined) record.savedPresetsJson = body.savedPresetsJson ?? null;

  db.persist();
  return NextResponse.json({ ok: true });
}
