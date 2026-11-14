import { NextResponse } from 'next/server';

import type { SystemConfig } from '@/lib/types';
import { getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 7 — Branding, carousel copy and onboarding video links. */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as Partial<SystemConfig>;
  const db = getDb();

  db.systemConfig = { ...db.systemConfig, ...body, loginCarouselJson: body.loginCarouselJson ?? db.systemConfig.loginCarouselJson };
  db.persist();
  db.audit(admin.username, 'SYSTEM_CONFIG_UPDATE', null);

  return NextResponse.json({ ok: true, systemConfig: db.systemConfig });
}
