'use client';

import { useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icons';
import { Btn, Card, Empty, Field, TextInput } from '../shared';
import type { Overview } from '../types';

/**
 * MODULE 9  Security Audit Logs & Google Drive Cloud Backup.
 *
 * Three real operations:
 *  - Read the AdminAuditLog (server-side chronological trail).
 *  - Download the full database + config snapshot as JSON.
 *  - Re-import a snapshot. The merge is additive by id, so restoring an older
 *    backup can never delete a customer who signed up since.
 *  - Upload the snapshot to the owner's Google Drive backup folder.
 */

const DRIVE_BACKUP_FOLDER = 'Alpha X Scanner Project Development/03_Database_Backups_&_Memory_Logs';

export function SecurityModule({
  data,
  reload,
  toast,
}: {
  data: Overview;
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const logs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.auditLogs
      .filter((l) => (q ? l.adminUsername.toLowerCase().includes(q) || l.action.toLowerCase().includes(q) : true))
      .slice(0, 300);
  }, [data.auditLogs, query]);

  const exportBackup = async () => {
    setBusy('export');
    try {
      const res = await fetch('/api/admin/backup');
      if (!res.ok) {
        toast('Export failed.', 'warn');
        return;
      }
      const blob = await res.blob();
      const name =
        res.headers.get('content-disposition')?.match(/filename="(.+?)"/)?.[1] ?? 'alpha-x-scanner-backup.json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup downloaded.');
      await reload();
    } catch {
      toast('Network error — export failed.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async (file: File) => {
    setBusy('import');
    try {
      const text = await file.text();
      const res = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text,
      });
      const json = (await res.json()) as { ok: boolean; error?: string; counts?: Record<string, number> };
      if (!json.ok) {
        toast(IMPORT_ERRORS[json.error ?? 'UNKNOWN'] ?? 'Restore failed.', 'warn');
        return;
      }
      const parts = Object.entries(json.counts ?? {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k} +${v}`)
        .join(', ');
      toast(`Backup restored (merged): ${parts || 'no new rows'}.`);
      await reload();
    } catch {
      toast('Network error — nothing was imported.', 'warn');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /**
   * Google Drive sync.
   *
   * The Drive app connected to this conversation is the transport; the browser
   * hands the freshly downloaded snapshot to it. When the app is not connected
   * we fall back to downloading the file so the owner can drag it into the
   * backup folder manually — never a dead button.
   */
  const syncToDrive = async () => {
    setBusy('drive');
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const res = await fetch('/api/admin/drive-sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: `alpha-x-scanner-backup-${stamp}.json`, folder: DRIVE_BACKUP_FOLDER }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        available?: boolean;
        webViewLink?: string | null;
        outboxPath?: string | null;
        reason?: string | null;
      };

      if (json.ok && json.available && json.webViewLink) {
        setDriveLink(json.webViewLink ?? null);
        toast(`Snapshot uploaded to Google Drive → ${DRIVE_BACKUP_FOLDER}`);
        await reload();
        return;
      }

      /* Transport not configured on this server: still deliver the artifact so
         the button is never a no-op. */
      setDriveLink(null);
      toast(
        `Google Drive is not linked on this server${json.reason ? ` (${json.reason})` : ''} — ` +
          `${json.outboxPath ? `snapshot staged at ${json.outboxPath}; ` : ''}downloading it now. ` +
          `Drop it into “${DRIVE_BACKUP_FOLDER}”.`,
        'warn',
      );
      await exportBackup();
    } catch {
      toast('Snapshot failed.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <Card
        title="Cloud Backup & Disaster Recovery"
        icon="shieldAlert"
        subtitle={`Snapshots include users, license keys, scanner configs, system config, risk notices, VIP signals and the audit trail. Session secrets are never exported.`}
        actions={
          <>
            <Btn tone="green" icon="download" busy={busy === 'export'} onClick={exportBackup}>
              📥 Export Full Database &amp; Config Backup (.json)
            </Btn>
            <Btn tone="blue" icon="download" busy={busy === 'drive'} onClick={syncToDrive}>
              ☁️ Sync Backup Snapshot to Google Drive
            </Btn>
          </>
        }
      >
        <div className="space-y-2.5 p-3">
          <div className="rounded border border-white/[0.06] bg-bg-card-2 p-2.5">
            <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-text-muted">
              Import &amp; Restore
            </div>
            <p className="mb-2 text-[10.5px] leading-relaxed text-text-secondary">
              Restoring is <span className="font-semibold text-white">non-destructive</span>: rows are merged by id, so
              an older backup can never delete customers, licenses or config added since.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importBackup(f);
              }}
            />
            <Btn tone="violet" icon="download" busy={busy === 'import'} onClick={() => fileRef.current?.click()}>
              📤 Import &amp; Restore Backup (.json)
            </Btn>
          </div>

          <p className="mono-num text-[9.5px] text-text-muted">
            Drive destination: <span className="text-amber-400">{DRIVE_BACKUP_FOLDER}</span>
          </p>
          {driveLink ? (
            <a
              href={driveLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-400 hover:underline"
            >
              <Icon name="external" size={11} />
              Open the uploaded snapshot in Google Drive ↗
            </a>
          ) : null}
        </div>
      </Card>

      <Card
        title="Security Audit Log"
        icon="lock"
        subtitle={`${data.auditLogs.length} most recent admin actions`}
        actions={
          <div className="w-56">
            <TextInput value={query} onChange={setQuery} placeholder="Filter by admin or action…" mono />
          </div>
        }
      >
        {logs.length === 0 ? (
          <Empty>No audit entries match this filter.</Empty>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-bg-card text-[9.5px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-3 py-1.5 font-bold">When</th>
                  <th className="px-2 py-1.5 font-bold">Admin</th>
                  <th className="px-2 py-1.5 font-bold">Action</th>
                  <th className="px-3 py-1.5 font-bold">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {logs.map((l) => (
                  <tr key={l.id} className="text-[10.5px] hover:bg-white/[0.02]">
                    <td className="mono-num whitespace-nowrap px-3 py-1 text-text-muted">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1">
                      <span className="font-bold text-amber-300">{l.adminUsername}</span>
                    </td>
                    <td className="px-2 py-1">
                      <span className="mono-num rounded border border-white/10 bg-white/[0.04] px-1.5 py-px text-[9.5px] font-semibold text-text-bright">
                        {l.action}
                      </span>
                    </td>
                    <td className="mono-num px-3 py-1 text-text-muted">
                      {l.targetId ? (
                        <span className="flex items-center gap-1">
                          <Icon name="crosshair" size={10} />
                          {l.targetId}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const IMPORT_ERRORS: Record<string, string> = {
  BAD_JSON: 'That file is not valid JSON.',
  EMPTY_BODY: 'That file is empty.',
  PAYLOAD_TOO_LARGE: 'That file is too large to be a valid backup.',
  NEWER_SNAPSHOT: 'That backup was created by a newer version of Alpha X Scanner.',
  MISSING_VERSION: 'That file is not an Alpha X Scanner backup.',
  FORBIDDEN: 'Admin access required.',
};
