'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/ui/Icons';
import { Btn, Card, CopyBtn, Empty, Modal, StatusPill, TextInput } from '../shared';
import { toWhatsAppIntl } from './OnboardingModule';
import type { Overview, UserRow } from '../types';

/**
 * MODULE 4  Users, Password Resetter & Session Matrix.
 *
 * Password changes are hashed server-side with the same salted SHA-256 used at
 * login, so an admin can reset the demo or the owner account safely.
 */

export function UsersModule({
  data,
  reload,
  toast,
}: {
  data: Overview;
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const [pwUser, setPwUser] = useState<UserRow | null>(null);
  const [newPw, setNewPw] = useState('');

  const [swapUser, setSwapUser] = useState<UserRow | null>(null);
  const [swapKey, setSwapKey] = useState('');

  /* §3.2  Deletion is irreversible and reaches Supabase, so it gets its own
     confirmation step rather than firing from the row. */
  const [removeUser, setRemoveUser] = useState<UserRow | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.users]
      .filter((u) => (q ? u.username.toLowerCase().includes(q) || (u.licenseKey ?? '').toLowerCase().includes(q) : true))
      .sort((a, b) => Number(a.role === 'ADMIN') * -1 + Number(b.role === 'ADMIN'));
  }, [data.users, query]);

  const act = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast(USER_ERRORS[json.error ?? 'UNKNOWN'] ?? 'Action failed.', 'warn');
        return false;
      }
      toast(okMsg);
      await reload();
      return true;
    } catch {
      toast('Network error — nothing changed.', 'warn');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    if (!pwUser) return;
    const ok = await act({ action: 'reset-password', userId: pwUser.id, password: newPw }, `Password updated for ${pwUser.username}.`);
    if (ok) {
      setPwUser(null);
      setNewPw('');
    }
  };

  const submitSwap = async () => {
    if (!swapUser) return;
    const ok = await act({ action: 'assign-key', userId: swapUser.id, licenseKey: swapKey.trim() }, `Key assigned to ${swapUser.username}.`);
    if (ok) {
      setSwapUser(null);
      setSwapKey('');
    }
  };

  return (
    <div className="space-y-3">
      <Card
        title="Users & Session Matrix"
        icon="user"
        subtitle={`${data.users.length} accounts · ${data.kpis.onlineWsClients} socket(s) live`}
        actions={
          <div className="w-56">
            <TextInput value={query} onChange={setQuery} placeholder="Search username or key…" />
          </div>
        }
      >
        {visible.length === 0 ? (
          <Empty>No users match this search.</Empty>
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-bg-card text-[9.5px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-3 py-1.5 font-bold">Username</th>
                  <th className="px-2 py-1.5 font-bold">Role</th>
                  <th className="px-2 py-1.5 font-bold">Plan</th>
                  <th className="px-2 py-1.5 font-bold">Bound License Key</th>
                  <th className="px-2 py-1.5 font-bold">Last Seen</th>
                  <th className="px-2 py-1.5 font-bold">Status</th>
                  <th className="px-3 py-1.5 font-bold">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {visible.map((u) => {
                  const intl = toWhatsAppIntl(u.whatsappNumber);
                  return (
                    <tr key={u.id} className="text-[11px] hover:bg-white/[0.02]">
                      <td className="px-3 py-1.5">
                        <span className="font-bold text-white">{u.username}</span>
                        {u.whatsappNumber ? (
                          <span className="mono-num ml-1.5 text-[9.5px] text-text-muted">{u.whatsappNumber}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusPill status={u.role} />
                      </td>
                      <td className="px-2 py-1.5 text-text-secondary">{u.plan}</td>
                      <td className="px-2 py-1.5">
                        {u.licenseKey ? (
                          <span className="flex items-center gap-1.5">
                            <span className="mono-num select-all text-emerald-400">{u.licenseKey}</span>
                            <CopyBtn value={u.licenseKey} />
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="mono-num px-2 py-1.5 text-text-secondary">{relative(u.lastSeenAt)}</td>
                      <td className="px-2 py-1.5">
                        <StatusPill status={u.isSuspended ? 'Suspended' : 'Active'} />
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          <Btn
                            tone="blue"
                            icon="key"
                            disabled={busy}
                            onClick={() => {
                              setPwUser(u);
                              setNewPw('');
                            }}
                          >
                            🔐 Change Password
                          </Btn>
                          <Btn
                            tone="violet"
                            icon="lock"
                            disabled={busy}
                            onClick={() => {
                              setSwapUser(u);
                              setSwapKey(u.licenseKey ?? '');
                            }}
                          >
                            🔑 Assign / Swap Key
                          </Btn>
                          <Btn
                            icon="refresh"
                            disabled={busy}
                            onClick={() => void act({ action: 'reset-devices', userId: u.id }, `Device lock cleared for ${u.username}.`)}
                          >
                            🔓 Reset Device Lock
                          </Btn>
                          <Btn
                            tone={u.isSuspended ? 'green' : 'amber'}
                            disabled={busy}
                            onClick={() =>
                              void act(
                                { action: 'suspend', userId: u.id, value: !u.isSuspended },
                                u.isSuspended ? `${u.username} unsuspended.` : `${u.username} suspended — socket dropped.`,
                              )
                            }
                          >
                            {u.isSuspended ? '▶ Unsuspend' : '⏸ Suspend'}
                          </Btn>
                          <Btn
                            tone="red"
                            disabled={busy}
                            onClick={() => setRemoveUser(u)}
                          >
                            🗑 Remove User
                          </Btn>
                          {intl ? (
                            <a
                              href={`https://wa.me/${intl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[10.5px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
                            >
                              <Icon name="whatsapp" size={11} />
                              WhatsApp ↗
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Password resetter */}
      <Modal open={pwUser !== null} onClose={() => setPwUser(null)} title={`Change Password — ${pwUser?.username ?? ''}`}>
        <div className="space-y-3">
          <p className="text-[10.5px] leading-relaxed text-text-muted">
            Works on any account including <span className="mono-num font-semibold text-white">admin</span> and{' '}
            <span className="mono-num font-semibold text-white">demo</span>. The password is salt-hashed server-side, so it is never stored in
            plain text.
          </p>
          <TextInput value={newPw} onChange={setNewPw} placeholder="new password (min 6 chars)" mono />
          <div className="flex justify-end gap-2">
            <Btn icon="reset" onClick={() => setPwUser(null)}>
              Cancel
            </Btn>
            <Btn tone="green" icon="key" busy={busy} disabled={newPw.length < 6} onClick={submitPassword}>
              Apply New Password
            </Btn>
          </div>
        </div>
      </Modal>

      {/* §3.2  Permanent removal — confirmed, then deleted from Supabase too. */}
      <Modal
        open={removeUser !== null}
        onClose={() => setRemoveUser(null)}
        title={`Remove ${removeUser?.username ?? ''} permanently?`}
        width={460}
      >
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-text-secondary">
            This deletes the account from memory, from the on-disk snapshot and from Supabase Postgres. It cannot be
            undone, and the customer will not be able to sign in again.
          </p>
          <p className="text-[10.5px] leading-relaxed text-text-muted">
            Their license key is <span className="font-semibold text-text-bright">released, not deleted</span> — it
            returns to the vault as an unassigned key you can hand to someone else.
          </p>
          {removeUser?.role === 'ADMIN' ? (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] font-semibold text-amber-400">
              This is an administrator account. The last remaining admin cannot be removed.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Btn icon="reset" onClick={() => setRemoveUser(null)}>
              Cancel
            </Btn>
            <Btn
              tone="red"
              icon="shieldAlert"
              busy={busy}
              onClick={async () => {
                if (!removeUser) return;
                await act({ action: 'delete', userId: removeUser.id }, `${removeUser.username} removed permanently.`);
                setRemoveUser(null);
              }}
            >
              🗑 Delete Permanently
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Key swap */}
      <Modal open={swapUser !== null} onClose={() => setSwapUser(null)} title={`Assign / Swap Key — ${swapUser?.username ?? ''}`} width={480}>
        <div className="space-y-3">
          <p className="text-[10.5px] leading-relaxed text-text-muted">
            Binding a key releases any key the customer held before, and releases this key from any previous holder — no customer can ever be
            left mid-session without a licence.
          </p>
          <TextInput value={swapKey} onChange={setSwapKey} placeholder="APS-XXXX-XXXX-XXXX" mono />
          <div className="max-h-40 overflow-auto rounded border border-white/[0.06] bg-black/30 p-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-text-muted">Unassigned keys</div>
            <ul className="space-y-0.5">
              {data.licenses
                .filter((l) => !l.assignedUserId && l.status === 'ACTIVE')
                .slice(0, 40)
                .map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setSwapKey(l.keyString)}
                      className="mono-num text-[10.5px] text-emerald-400 hover:underline"
                    >
                      {l.keyString}
                    </button>
                  </li>
                ))}
              {data.licenses.filter((l) => !l.assignedUserId && l.status === 'ACTIVE').length === 0 ? (
                <li className="text-[10.5px] text-text-muted">None available — mint a batch first.</li>
              ) : null}
            </ul>
          </div>
          <div className="flex justify-end gap-2">
            <Btn icon="reset" onClick={() => setSwapUser(null)}>
              Cancel
            </Btn>
            <Btn tone="violet" icon="lock" busy={busy} onClick={submitSwap}>
              Bind Key to Customer
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function relative(ts: number | null): string {
  if (ts === null) return 'never';
  const ms = Date.now() - ts;
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const USER_ERRORS: Record<string, string> = {
  LICENSE_NOT_FOUND: 'No such license key exists.',
  LICENSE_IN_USE: 'That key is already bound to another customer.',
  MISSING_PASSWORD: 'Enter a new password.',
  TOO_SHORT: 'Password must be at least 6 characters.',
  USER_NOT_FOUND: 'User no longer exists.',
  BAD_ACTION: 'That action is not supported.',
  FORBIDDEN: 'Admin access required.',
};
