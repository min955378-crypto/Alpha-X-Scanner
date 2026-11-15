import { NextResponse } from 'next/server';

import { SNAPSHOT_VERSION, getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Max accepted restore payload — a full 600-coin universe backup is < 2 MB. */
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/**
 * MODULE 9  Snapshot export & non-destructive restore.
 *
 *   GET  → download the complete state as JSON (Users, LicenseKeys,
 *          ScannerConfigs, SystemConfig, RiskWatchItems, CustomSignals,
 *          AuditLogs). `secret` is deliberately excluded.
 *   POST → merge a backup back in. Merging is additive by id so restoring an
 *          older snapshot can never delete customers who signed up since.
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const db = getDb();
  const snapshot = db.exportSnapshot();
  db.audit(admin.username, 'BACKUP_EXPORT', null);

  const stamp = new Date(snapshot.exportedAt).toISOString().replace(/[:.]/g, '-');
  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="alpha-x-scanner-backup-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
}

async function handlePost(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const raw = await req.text().catch(() => '');
  if (!raw) return NextResponse.json({ ok: false, error: 'EMPTY_BODY' }, { status: 400 });
  if (raw.length > MAX_IMPORT_BYTES) {
    return NextResponse.json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  const snap = parsed as { version?: number };
  if (typeof snap?.version === 'number' && snap.version > SNAPSHOT_VERSION) {
    return NextResponse.json(
      { ok: false, error: 'NEWER_SNAPSHOT', snapshotVersion: snap.version, supportedVersion: SNAPSHOT_VERSION },
      { status: 400 },
    );
  }

  const db = getDb();
  const result = db.importSnapshot(parsed);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  db.audit(admin.username, 'BACKUP_IMPORT', null);
  return NextResponse.json({ ok: true, counts: result.counts });
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}
