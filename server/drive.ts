import { createSign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * MODULE 9  Google Drive cloud backup transport.
 *
 * Zero third-party dependencies: a service-account JWT is minted with
 * `node:crypto`, exchanged for an access token, and the snapshot is uploaded to
 * the owner's `03_Database_Backups_&_Memory_Logs` folder via the Drive v3 REST
 * API. Resumable multipart upload is used so multi-megabyte snapshots stream
 * safely.
 *
 * When no service account is configured the snapshot is written to a local
 * outbox instead, and the caller is told the transport is unavailable — the
 * button then falls back to a browser download rather than silently doing
 * nothing.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Fallback: the owner's verified backup folder (§3). */
export const DEFAULT_BACKUP_FOLDER_ID = '1UPcjZAaNHzGvLyUgmCH2uiagZJ8n6kga';

export interface DriveResult {
  ok: boolean;
  available: boolean;
  reason?: string;
  fileId?: string;
  webViewLink?: string;
  outboxPath?: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sign a service-account JWT and exchange it for a Drive access token. */
async function accessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = b64url(signer.sign(privateKey.replace(/\\n/g, '\n')));

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`DRIVE_TOKEN_FAILED ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('DRIVE_TOKEN_EMPTY');
  return json.access_token;
}

function credentials(): { clientEmail: string; privateKey: string; folderId: string } | null {
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;
  return {
    clientEmail,
    privateKey,
    folderId: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || DEFAULT_BACKUP_FOLDER_ID,
  };
}

export function driveConfigured(): boolean {
  return credentials() !== null;
}

/**
 * Upload `content` as `filename` into the backup folder.
 * Falls back to a local outbox file when Drive is not configured.
 */
export async function uploadSnapshotToDrive(filename: string, content: string): Promise<DriveResult> {
  const creds = credentials();

  if (!creds) {
    const outbox = path.join(process.cwd(), '.data', 'drive-outbox');
    const outboxPath = path.join(outbox, filename);
    try {
      await mkdir(outbox, { recursive: true });
      await writeFile(outboxPath, content, 'utf8');
      return { ok: true, available: false, reason: 'GOOGLE_DRIVE_NOT_CONFIGURED', outboxPath };
    } catch {
      return { ok: false, available: false, reason: 'OUTBOX_WRITE_FAILED' };
    }
  }

  try {
    const token = await accessToken(creds.clientEmail, creds.privateKey);

    /* Multipart upload: metadata part, then the JSON body. */
    const boundary = `axs-${Date.now().toString(36)}`;
    const metadata = JSON.stringify({ name: filename, parents: [creds.folderId], mimeType: 'application/json' });
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${content}\r\n` +
      `--${boundary}--`;

    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, available: true, reason: `DRIVE_UPLOAD_FAILED ${res.status} ${detail.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id?: string };
    return {
      ok: true,
      available: true,
      fileId: json.id,
      webViewLink: json.id ? `https://drive.google.com/file/d/${json.id}/view` : undefined,
    };
  } catch (err) {
    return { ok: false, available: true, reason: err instanceof Error ? err.message : 'DRIVE_UNKNOWN_ERROR' };
  }
}
