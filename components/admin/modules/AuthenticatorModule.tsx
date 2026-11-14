'use client';

import { useCallback, useEffect, useState } from 'react';

import { QRCodeSVG } from '../QRCodeSVG';
import { Btn, Card, Field, TextInput } from '../shared';
import { adminAuthMessage } from '../AdminAuthGate';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * MODULE 5  Authenticator 2FA & Admin Security.
 *
 * Everything here talks to `POST /api/admin/auth`, which requires an existing
 * ADMIN session — so a code can only ever be enrolled, tested or removed by
 * someone who is already signed in.
 *
 * The panel deliberately shows the QR code and the raw setup key again on
 * demand. Losing a phone is the common case, and an admin who cannot re-pair
 * is locked out permanently.
 */

interface SetupInfo {
  secret: string;
  uri: string;
  enabled: boolean;
}

export function AuthenticatorModule({
  toast,
}: {
  data: unknown;
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const { user } = useAuth();
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      });
      if (res.ok) {
        const data = (await res.json()) as SetupInfo & { ok: boolean };
        if (data.ok) setSetup({ secret: data.secret, uri: data.uri, enabled: data.enabled });
      } else {
        toast('Could not load authenticator settings.', 'warn');
      }
    } catch {
      toast('Network error — could not load authenticator settings.', 'warn');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(body: Record<string, unknown>, okMessage: string): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        secret?: string;
        uri?: string;
        enabled?: boolean;
        username?: string;
      };
      if (!res.ok || !data.ok) {
        setError(adminAuthMessage(data.error));
        return false;
      }
      if (data.secret) setSetup({ secret: data.secret, uri: data.uri ?? '', enabled: data.enabled === true });
      else if (typeof data.enabled === 'boolean') setSetup((s) => (s ? { ...s, enabled: data.enabled! } : s));
      toast(okMessage);
      setCode('');
      return true;
    } catch {
      setError('Network error — could not reach the admin service.');
      return false;
    }
  }

  const enabled = setup?.enabled === true;

  async function run(key: string, body: Record<string, unknown>, msg: string) {
    setBusy(key);
    await call(body, msg);
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      {/* ---------------------------- status + QR --------------------------- */}
      <Card title="📲 Authenticator App (2FA)">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div className="rounded-xl bg-white p-2.5">
              {loading || !setup ? (
                <div className="h-[150px] w-[150px] animate-pulse bg-gray-200" />
              ) : (
                <QRCodeSVG value={setup.uri} size={150} />
              )}
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold ${
                enabled
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : 'border-amber-500/50 bg-amber-500/15 text-amber-400'
              }`}
            >
              {enabled ? '2FA ACTIVE' : '2FA NOT ENABLED'}
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[11px] leading-relaxed text-text-secondary">
              {enabled
                ? 'A valid 6-digit code from your authenticator app is required every time you sign in to /admin.'
                : 'Pairing is optional. Until you verify a code, your password alone signs you in — so you can never be locked out by a lost phone.'}
            </p>

            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Manual Setup Key
              </div>
              <code className="mono-num block select-all break-all rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-text-bright">
                {setup?.secret ?? '—'}
              </code>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Btn
                icon="refresh"
                disabled={busy !== null}
                onClick={() => void run('rotate', { action: 'rotate' }, 'New setup key generated — 2FA switched off until you re-pair.')}
              >
                🔄 Rotate Secret
              </Btn>
              <Btn
                tone={enabled ? 'red' : 'green'}
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    enabled ? 'disable' : 'enable',
                    enabled ? { action: 'disable', code: code.trim() } : { action: 'enable', code: code.trim() },
                    enabled ? '2FA switched off.' : '2FA enabled — a code is now required at sign-in.',
                  )
                }
              >
                {enabled ? '⏸ Disable 2FA' : '🔐 Enable 2FA'}
              </Btn>
            </div>
          </div>
        </div>

        {/* ------------------------------ test ----------------------------- */}
        <div className="mt-3 border-t border-white/5 pt-3">
          <Field label="6-Digit Code">
            <div className="flex items-center gap-1.5">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]*"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-32 rounded border border-white/12 bg-black/40 px-2 py-1 text-center font-mono text-[13px] tracking-[0.35em] text-text-bright outline-none focus:border-[#F5B301]/60"
              />
              <Btn
                disabled={busy !== null || code.trim().length !== 6}
                onClick={() => void run('verify', { action: 'verify', code: code.trim() }, 'Code is valid.')}
              >
                ✅ Test Code
              </Btn>
            </div>
          </Field>
          {enabled ? (
            <p className="mt-1 text-[10px] text-text-muted">
              Disabling requires a current valid code — enter it above first.
            </p>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-400"
          >
            {error}
          </div>
        ) : null}
      </Card>

      {/* --------------------------- credentials --------------------------- */}
      <Card title="🔑 Admin Credentials">
        <div className="grid gap-3 sm:grid-cols-2">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run('password', { action: 'change-password', currentPassword, newPassword }, 'Admin password updated.');
            }}
          >
            <Field label="Current Password">
              <TextInput
                type="password"
                value={currentPassword}
                onChange={setCurrentPassword}
                placeholder="••••••••"
              />
            </Field>
            <Field label="New Password">
              <TextInput
                type="password"
                value={newPassword}
                onChange={setNewPassword}
                placeholder="At least 6 characters"
              />
            </Field>
            <Btn
              tone="green"
              disabled={busy !== null || !currentPassword || newPassword.length < 6}
              onClick={() =>
                void run('password', { action: 'change-password', currentPassword, newPassword }, 'Admin password updated.')
              }
            >
              💾 Update Password
            </Btn>
          </form>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run('username', { action: 'change-username', newUsername, password: currentPassword }, 'Admin username updated.');
            }}
          >
            <Field label="New Admin Username">
              <TextInput value={newUsername} onChange={setNewUsername} placeholder={user?.username ?? 'admin'} />
            </Field>
            <Field label="Confirm With Password">
              <TextInput
                type="password"
                value={currentPassword}
                onChange={setCurrentPassword}
                placeholder="••••••••"
              />
            </Field>
            <Btn
              tone="green"
              disabled={busy !== null || newUsername.trim().length < 3 || !currentPassword}
              onClick={() =>
                void run('username', { action: 'change-username', newUsername, password: currentPassword }, 'Admin username updated.')
              }
            >
              💾 Update Username
            </Btn>
          </form>
        </div>
      </Card>
    </div>
  );
}
