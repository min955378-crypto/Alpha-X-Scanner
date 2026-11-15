import { NextResponse } from 'next/server';

import type { BroadcastLevel, BroadcastSeverity, BroadcastState } from '@/lib/types';
import { getDb } from '@/server/engine/db';
import { pushBroadcast } from '@/server/ws';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEVERITIES: BroadcastSeverity[] = ['INFO', 'BULLISH', 'WARNING', 'URGENT'];

/** Urgent and warning banners render red/amber; info and bullish render calm. */
function levelFor(severity: BroadcastSeverity): BroadcastLevel {
  return severity === 'WARNING' || severity === 'URGENT' ? 'warn' : 'info';
}

/**
 * MODULE 8  Global announcement banner.
 *
 *   POST  → push to every live socket AND persist, so a client that connects
 *           afterwards (or reloads) still sees the banner instead of silently
 *           missing it.
 *   DELETE → clear the banner everywhere.
 */
async function handlePost(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    message?: string;
    severity?: BroadcastSeverity;
    /** Hours the banner keeps being served to newly-connecting clients. */
    durationHours?: number | null;
  };

  const title = (body.title ?? '').trim();
  const message = (body.message ?? '').trim();
  if (!title) return NextResponse.json({ ok: false, error: 'MISSING_TITLE' }, { status: 400 });
  if (title.length > 240) return NextResponse.json({ ok: false, error: 'TITLE_TOO_LONG' }, { status: 400 });
  if (message.length > 600) return NextResponse.json({ ok: false, error: 'MESSAGE_TOO_LONG' }, { status: 400 });

  const severity: BroadcastSeverity = body.severity && SEVERITIES.includes(body.severity) ? body.severity : 'INFO';
  const now = Date.now();
  const hours = typeof body.durationHours === 'number' && body.durationHours > 0 ? body.durationHours : 24;

  const state: BroadcastState = {
    title,
    message,
    severity,
    createdAt: now,
    createdBy: admin.username,
    expiresAt: now + hours * 3_600_000,
  };

  const db = getDb();
  db.systemConfig = { ...db.systemConfig, broadcast: state };
  db.persist();
  db.audit(admin.username, `BROADCAST ${severity}`, null);

  pushBroadcast(title, message, severity, levelFor(severity), now);

  return NextResponse.json({ ok: true, broadcast: state });
}

/** Clearing is a real state change: drop the row and notify live sockets. */
async function handleDelete(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const db = getDb();
  db.systemConfig = { ...db.systemConfig, broadcast: null };
  db.persist();
  db.audit(admin.username, 'BROADCAST_CLEAR', null);

  pushBroadcast('', '', 'INFO', 'info', Date.now());
  return NextResponse.json({ ok: true });
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}

export async function DELETE(req: Request) {
  return flushAfter(handleDelete(req));
}
