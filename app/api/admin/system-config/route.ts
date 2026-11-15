import { NextResponse } from 'next/server';

import type { SystemConfig } from '@/lib/types';
import { getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 7 — Branding, carousel copy and onboarding video links. */
async function handlePost(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as Partial<SystemConfig>;
  const db = getDb();

  db.systemConfig = { ...db.systemConfig, ...body, loginCarouselJson: body.loginCarouselJson ?? db.systemConfig.loginCarouselJson };
  db.persist();
  db.audit(admin.username, 'SYSTEM_CONFIG_UPDATE', null);

  return NextResponse.json({ ok: true, systemConfig: db.systemConfig });
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}
