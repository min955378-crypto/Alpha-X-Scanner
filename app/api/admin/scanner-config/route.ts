import { NextResponse } from 'next/server';

import { TIMEFRAMES, type ScannerSlug, type Timeframe } from '@/lib/types';
import { getDb } from '@/server/engine/db';
import { getEngine } from '@/server/engine';
import { invalidateScanParams } from '@/server/engine/scanparams';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 5 — Scanner math & parameter tuning, no redeploy required. */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    slug?: ScannerSlug;
    enabled?: boolean;
    defaultTimeframe?: Timeframe;
    scanIntervalSec?: number;
    subtitle?: string;
    parametersJson?: Record<string, number>;
  };

  if (!body.slug) return NextResponse.json({ ok: false, error: 'MISSING_SLUG' }, { status: 400 });

  const db = getDb();
  const cfg = db.scannerConfigs.get(body.slug);
  if (!cfg) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });

  if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled;
  if (body.defaultTimeframe && TIMEFRAMES.includes(body.defaultTimeframe)) cfg.defaultTimeframe = body.defaultTimeframe;
  if (typeof body.scanIntervalSec === 'number') cfg.scanIntervalSec = Math.max(15, Math.min(600, body.scanIntervalSec));
  if (typeof body.subtitle === 'string') cfg.subtitle = body.subtitle;
  if (body.parametersJson) cfg.parametersJson = { ...cfg.parametersJson, ...body.parametersJson };
  cfg.updatedAt = Date.now();

  db.persist();
  db.audit(admin.username, 'SCANNER_CONFIG_UPDATE', body.slug);

  /* MODULE 5  Hot-reload: drop the parameter memo, rebuild the warm-up series
     that structural parameters (EMA periods, RSI length, swing-bar bounds)
     bake into, then rescan immediately so the owner sees the effect at once
     instead of waiting for the next 60s cycle. */
  invalidateScanParams();
  const rewarmed = getEngine().applyScannerConfig();

  return NextResponse.json({ ok: true, config: cfg, rewarmed });
}
