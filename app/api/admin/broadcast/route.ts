import { NextResponse } from 'next/server';

import { getDb } from '@/server/engine/db';
import { pushBroadcast } from '@/server/ws';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 7 — Push a live announcement toast to every connected client. */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as { title?: string; body?: string; level?: 'info' | 'warn' };
  if (!body.title) return NextResponse.json({ ok: false, error: 'MISSING_TITLE' }, { status: 400 });

  pushBroadcast(body.title, body.body ?? '', body.level ?? 'info');
  getDb().audit(admin.username, 'BROADCAST', null);

  return NextResponse.json({ ok: true });
}
