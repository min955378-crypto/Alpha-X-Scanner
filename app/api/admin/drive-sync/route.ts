import { NextResponse } from 'next/server';

import { getDb } from '@/server/engine/db';
import { DEFAULT_BACKUP_FOLDER_ID, driveConfigured, uploadSnapshotToDrive } from '@/server/drive';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;

/**
 * MODULE 9  Push the current database snapshot to Google Drive.
 *
 * The client may either let the server build a fresh snapshot (omit `content`)
 * or relay one it already downloaded (so the export and the Drive sync are
 * guaranteed to be byte-identical).
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    filename?: string;
    folder?: string;
    content?: string;
  };

  const content = body.content ?? JSON.stringify(getDb().exportSnapshot(), null, 2);
  if (content.length > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = (body.filename ?? `alpha-x-scanner-backup-${stamp}.json`).replace(/[^a-zA-Z0-9._-]/g, '_');

  const result = await uploadSnapshotToDrive(filename, content);

  getDb().audit(admin.username, result.ok && result.available ? 'DRIVE_SYNC_OK' : 'DRIVE_SYNC_LOCAL', filename);

  return NextResponse.json({
    ok: result.ok,
    available: result.available,
    reason: result.reason ?? null,
    fileId: result.fileId ?? null,
    webViewLink: result.webViewLink ?? null,
    outboxPath: result.outboxPath ?? null,
    folder: body.folder ?? 'Alpha X Scanner Project Development/03_Database_Backups_&_Memory_Logs',
    folderId: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || DEFAULT_BACKUP_FOLDER_ID,
  });
}

/** Lets the portal show the real transport state instead of guessing. */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;

  return NextResponse.json({
    ok: true,
    configured: driveConfigured(),
    folderId: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || DEFAULT_BACKUP_FOLDER_ID,
  });
}
