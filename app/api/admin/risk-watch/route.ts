import { NextResponse } from 'next/server';

import type { RiskCategory } from '@/lib/types';
import { getDb } from '@/server/engine/db';
import { getEngine } from '@/server/engine';
import { refreshRiskWatch } from '@/server/engine/riskwatch';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES: RiskCategory[] = ['MONITORING_TAG', 'DELISTING_NOTICE', 'SPOT_NEWS'];

/**
 * MODULE 7  Binance Risk Watch CMS Manager.
 *
 *   GET            → pipeline status + every item
 *   POST sync      → force a live BAPI re-scrape (catalogId 161 / 48)
 *   POST pin       → pin/unpin an item to the top of Tab 7
 *   POST create    → add a custom exchange warning notice
 *   POST delete    → remove an outdated item
 */
export async function GET() {
  const engine = getEngine();
  await engine.start();
  return NextResponse.json({
    ok: true,
    items: engine.getRiskItems(),
    updatedAt: engine.riskUpdatedAt,
    nextSyncAt: engine.riskNextAt,
    lastError: engine.riskError,
  });
}

export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'sync' | 'pin' | 'create' | 'delete';
    id?: string;
    isPinned?: boolean;
    category?: RiskCategory;
    title?: string;
    symbol?: string | null;
    sourceUrl?: string;
    effectiveDelistDate?: number | null;
    badgeType?: 'Monitoring' | 'Notice' | 'Trading Pairs' | 'Delisting';
  };

  const db = getDb();
  const engine = getEngine();

  switch (body.action) {
    case 'sync': {
      const result = await refreshRiskWatch();
      engine.riskUpdatedAt = Date.now();
      engine.riskError = result.error;
      db.audit(admin.username, `RISK_SYNC ${result.source} (+${result.upserted})`, null);
      return NextResponse.json({
        result,
        updatedAt: engine.riskUpdatedAt,
        nextSyncAt: engine.riskNextAt,
        upserted: result.upserted,
        source: result.source,
        error: result.error,
      });
    }

    case 'pin': {
      if (!body.id) return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
      const item = db.setRiskItemPinned(body.id, Boolean(body.isPinned));
      if (!item) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
      db.audit(admin.username, `RISK_${item.isPinned ? 'PIN' : 'UNPIN'}`, item.id);
      return NextResponse.json({ ok: true, isPinned: item.isPinned });
    }

    case 'create': {
      const title = (body.title ?? '').trim();
      if (!title) return NextResponse.json({ ok: false, error: 'MISSING_TITLE' }, { status: 400 });
      const category = body.category && CATEGORIES.includes(body.category) ? body.category : 'SPOT_NEWS';

      const item = db.addRiskItem({
        category,
        badgeType: body.badgeType ?? 'Notice',
        symbol: body.symbol?.trim().toUpperCase() || null,
        title,
        publishedAt: Date.now(),
        effectiveDelistDate: body.effectiveDelistDate ?? null,
        sourceUrl: (body.sourceUrl ?? '').trim() || 'https://www.binance.com/en/support/announcement',
        isPinned: false,
      });
      db.audit(admin.username, `RISK_CREATE ${category}`, item.id);
      return NextResponse.json({ ok: true, item });
    }

    case 'delete': {
      if (!body.id) return NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 });
      const gone = db.deleteRiskItem(body.id);
      if (!gone) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
      db.audit(admin.username, 'RISK_DELETE', body.id);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ ok: false, error: 'BAD_ACTION' }, { status: 400 });
  }
}
