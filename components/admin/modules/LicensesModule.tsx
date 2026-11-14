'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/ui/Icons';
import { Btn, Card, CopyBtn, Empty, Field, PillSelect, StatusPill, TextInput, formatExpiry } from '../shared';
import type { Overview } from '../types';
import type { LicenseKeyRow } from '@/lib/types';

/**
 * MODULE 3  License Key Vault, Batch Generator & Device Lock Controller.
 *
 * Every quick action hits a real endpoint and then refreshes the overview, so
 * the table always reflects server state rather than optimistic guesswork.
 */

const QUANTITIES = [1, 5, 10, 25, 50];
const DURATIONS = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: '365d' },
  { value: 3650, label: 'Lifetime' },
];
const DEVICES = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 5, label: '5' },
  { value: 99, label: 'Unlimited' },
];

type Filter = 'ALL' | 'ACTIVE' | 'UNASSIGNED' | 'EXPIRING_SOON' | 'EXPIRED' | 'REVOKED';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'UNASSIGNED', label: 'Unassigned' },
  { value: 'EXPIRING_SOON', label: 'Expiring <72h' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'REVOKED', label: 'Revoked' },
];

function classify(l: LicenseKeyRow): Filter {
  const now = Date.now();
  if (l.status === 'REVOKED') return 'REVOKED';
  if (l.expiresAt !== null && l.expiresAt < now) return 'EXPIRED';
  if (!l.assignedUserId) return 'UNASSIGNED';
  if (l.expiresAt !== null && l.expiresAt - now < 3 * 86_400_000) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

export function LicensesModule({
  data,
  reload,
  toast,
}: {
  data: Overview;
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [qty, setQty] = useState(5);
  const [duration, setDuration] = useState(30);
  const [devices, setDevices] = useState(25);
  const [minted, setMinted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.licenses
      .filter((l) => (filter === 'ALL' ? true : classify(l) === filter))
      .filter((l) =>
        q
          ? l.keyString.toLowerCase().includes(q) || (l.assignedUsername ?? '').toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [data.licenses, filter, query]);

  const act = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/licenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; keys?: string[] };
      if (!json.ok) {
        toast(MINT_ERRORS[json.error ?? 'UNKNOWN'] ?? 'Action failed.', 'warn');
        return null;
      }
      toast(okMsg);
      await reload();
      return json;
    } catch {
      toast('Network error — nothing changed.', 'warn');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const mint = async () => {
    const json = await act({ action: 'generate', count: qty, durationDays: duration, maxDevices: devices }, `Minted ${qty} key(s).`);
    if (json?.keys) setMinted(json.keys);
  };

  const exportCsv = () => {
    const header = 'license_key,status,plan,duration_days,max_devices,assigned_username,activated_at,expires_at\n';
    const rows = minted
      .map((k) => data.licenses.find((l) => l.keyString === k))
      .filter((l): l is LicenseKeyRow => Boolean(l))
      .map((l) =>
        [
          l.keyString,
          l.status,
          l.plan,
          l.durationDays,
          l.maxDevices,
          l.assignedUsername ?? '',
          l.activatedAt ? new Date(l.activatedAt).toISOString() : '',
          l.expiresAt ? new Date(l.expiresAt).toISOString() : '',
        ].join(','),
      )
      .join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alpha-x-keys-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Batch generator */}
      <Card title="Batch Key Generator" icon="key" subtitle="Cryptographic APS-XXXX-XXXX-XXXX keys, minted server-side.">
        <div className="grid gap-3 p-3 lg:grid-cols-3">
          <Field label="Quantity">
            <PillSelect options={QUANTITIES.map((q) => ({ value: q, label: String(q) }))} value={qty} onChange={setQty} />
          </Field>
          <Field label="Duration">
            <PillSelect options={DURATIONS} value={duration} onChange={setDuration} />
          </Field>
          <Field label="Max Devices">
            <PillSelect options={DEVICES} value={devices} onChange={setDevices} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-3 py-2">
          <Btn tone="violet" icon="key" busy={busy} onClick={mint}>
            🔑 Mint License Batch
          </Btn>
          {minted.length ? (
            <>
              <CopyBtn value={minted.join('\n')} label="📋 Copy All New Keys" />
              <Btn icon="download" onClick={exportCsv}>
                📥 Export Keys CSV
              </Btn>
            </>
          ) : null}
        </div>

        {minted.length ? (
          <div className="border-t border-white/[0.06] bg-black/30 p-3">
            <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-text-muted">
              {minted.length} new key(s)
            </div>
            <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {minted.map((k) => (
                <li key={k} className="flex items-center justify-between gap-2 rounded border border-emerald-500/30 bg-emerald-500/[0.07] px-2 py-1">
                  <span className="mono-num text-[10.5px] font-semibold text-emerald-400">{k}</span>
                  <CopyBtn value={k} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* Table */}
      <Card
        title="License Key Vault"
        icon="lock"
        subtitle={`${visible.length} of ${data.licenses.length} keys`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <PillSelect options={FILTERS} value={filter} onChange={setFilter} />
            <div className="w-48">
              <TextInput value={query} onChange={setQuery} placeholder="Search key or customer…" />
            </div>
          </div>
        }
      >
        {visible.length === 0 ? (
          <Empty>No keys match this filter.</Empty>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-bg-card text-[9.5px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-3 py-1.5 font-bold">License Key</th>
                  <th className="px-2 py-1.5 font-bold">Status</th>
                  <th className="px-2 py-1.5 font-bold">Customer</th>
                  <th className="px-2 py-1.5 font-bold">Time Left</th>
                  <th className="px-2 py-1.5 font-bold">Devices</th>
                  <th className="px-3 py-1.5 font-bold">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {visible.map((l) => (
                  <LicenseRow key={l.id} lic={l} busy={busy} act={act} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function LicenseRow({
  lic,
  busy,
  act,
}: {
  lic: LicenseKeyRow;
  busy: boolean;
  act: (body: Record<string, unknown>, okMsg: string) => Promise<{ keys?: string[] } | null>;
}) {
  const expiry = formatExpiry(lic.expiresAt, lic.activatedAt);
  const revoked = lic.status === 'REVOKED';

  return (
    <tr className="text-[11px] hover:bg-white/[0.02]">
      <td className="px-3 py-1.5">
        <span className="flex items-center gap-1.5">
          <span className="mono-num select-all font-semibold text-white">{lic.keyString}</span>
          <CopyBtn value={lic.keyString} />
        </span>
      </td>
      <td className="px-2 py-1.5">
        <StatusPill status={lic.status} />
      </td>
      <td className="px-2 py-1.5">
        {lic.assignedUsername ? (
          <span className="font-semibold text-text-bright">{lic.assignedUsername}</span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <span className={`mono-num font-semibold ${expiry.tone}`}>{expiry.text}</span>
      </td>
      <td className="px-2 py-1.5">
        <span
          className={`mono-num font-semibold ${
            (lic.devicesUsed ?? 0) >= lic.maxDevices ? 'text-amber-400' : 'text-text-secondary'
          }`}
        >
          {lic.devicesUsed ?? 0} / {lic.maxDevices}
        </span>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          <Btn icon="refresh" disabled={busy} onClick={() => act({ action: 'reset-devices', licenseId: lic.id }, 'Device lock cleared.')} title="Clear all registered devices">
            🔓 Reset Devices
          </Btn>
          <Btn tone="green" disabled={busy} onClick={() => act({ action: 'extend', licenseId: lic.id, days: 7 }, 'Added 7 days.')}>
            +7d
          </Btn>
          <Btn tone="green" disabled={busy} onClick={() => act({ action: 'extend', licenseId: lic.id, days: 30 }, 'Added 30 days.')}>
            +30d
          </Btn>
          <select
            value={lic.maxDevices}
            disabled={busy}
            onChange={(e) => void act({ action: 'set-max-devices', licenseId: lic.id, maxDevices: Number(e.target.value) }, 'Max devices updated.')}
            className="rounded border border-white/10 bg-bg-card-2 px-1 py-0.5 text-[9.5px] text-text-secondary"
            title="Change max devices"
          >
            {[1, 2, 5, 99].map((n) => (
              <option key={n} value={n}>
                ⚙ {n === 99 ? 'Unlimited' : `${n} dev`}
              </option>
            ))}
          </select>
          <Btn
            tone={revoked ? 'green' : 'amber'}
            disabled={busy}
            onClick={() =>
              void act(
                { action: 'set-status', licenseId: lic.id, status: revoked ? 'ACTIVE' : 'REVOKED' },
                revoked ? 'Key reactivated.' : 'Key revoked — live sessions dropped.',
              )
            }
          >
            {revoked ? '▶ Activate' : '⏸ Revoke'}
          </Btn>
          <Btn
            tone="red"
            icon="download"
            disabled={busy}
            onClick={() => void act({ action: 'delete', licenseId: lic.id }, 'Key deleted.')}
            title="Only unassigned or revoked keys can be deleted"
          >
            🗑
          </Btn>
        </div>
      </td>
    </tr>
  );
}

const MINT_ERRORS: Record<string, string> = {
  NOT_FOUND: 'That key no longer exists — refresh and retry.',
  ASSIGNED_AND_ACTIVE: 'Revoke or unassign this key before deleting it.',
  BAD_DAYS: 'Invalid extension period.',
  FORBIDDEN: 'Admin access required.',
};
