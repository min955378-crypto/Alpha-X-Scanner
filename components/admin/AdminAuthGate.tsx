'use client';

import { QRCodeSVG } from './QRCodeSVG';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/components/providers/AuthProvider';
import { rememberSession } from '@/lib/storage';

/**
 * §2  Dedicated admin gate: Username + Password + Authenticator code.
 *
 * Rendered *inside* `/admin` whenever there is no authenticated ADMIN session.
 * It never navigates away — that is the §1.1 fix. Reaching `/admin` while
 * logged out, or while logged in as a customer, lands here rather than being
 * bounced to `/dashboard` or `/login`.
 *
 * Three states, driven by the server:
 *   credentials — the login form
 *   pairing     — password accepted, phone not paired yet (§2.3 Case A)
 *   done        — authenticated; the caller re-renders the portal
 */

type Stage = 'credentials' | 'pairing';

interface SetupInfo {
  secret: string;
  uri: string;
  enabled: boolean;
}

const GOLD = '#F5B301';

export function AdminAuthGate() {
  const { refresh, setUser } = useAuth();

  const [stage, setStage] = useState<Stage>('credentials');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [justPaired, setJustPaired] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  async function submitLogin(opts: { skipCode?: boolean } = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          username: username.trim(),
          password,
          /* §2.3 Case A — a blank code is a legitimate first-time login: the
             password alone gets the owner in, and the pairing wizard is
             offered afterwards. He can never be locked out by not having
             paired a phone yet. */
          code: opts.skipCode ? '' : code.trim(),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        user?: Record<string, unknown>;
        requiresSetup?: boolean;
        setup?: SetupInfo | null;
        justPaired?: boolean;
      };

      if (!res.ok || !data.ok) {
        setError(messageFor(data.error));
        if (data.error === 'TOTP_REQUIRED') setStage('credentials');
        return;
      }

      if (data.justPaired) setJustPaired(true);

      if (data.requiresSetup && data.setup) {
        setSetup(data.setup);
        setStage('pairing');
        return;
      }

      await finish(data.user);
    } catch {
      setError('Network error — could not reach the admin service.');
    } finally {
      setBusy(false);
    }
  }

  /** Adopt the server's session and hand control back to the portal. */
  async function finish(user?: Record<string, unknown>) {
    /* Replace any remembered customer identity with the admin's, so the
       localStorage session and the httpOnly cookie agree (§2.1). */
    rememberSession(typeof user?.username === 'string' ? user.username : 'admin');
    if (user) setUser(user as never);
    await refresh();
  }

  async function verifyAndEnable() {
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'enable', code: code.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(messageFor(data.error));
        return;
      }
      setJustPaired(true);
      await finish();
    } catch {
      setError('Network error — could not reach the admin service.');
    } finally {
      setBusy(false);
    }
  }

  const card = 'w-full max-w-[440px] rounded-2xl border border-white/10 bg-[#0C0E1A] p-6 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)]';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070913] p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(245,179,1,0.10), transparent 55%), radial-gradient(circle at 50% 100%, rgba(245,179,1,0.05), transparent 55%)',
        }}
      />

      <div className={`relative ${card}`}>
        {stage === 'credentials' ? (
          <CredentialsStage
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            passwordRef={passwordRef}
            code={code}
            setCode={setCode}
            busy={busy}
            error={error}
            onSubmit={submitLogin}
          />
        ) : (
          <PairingStage
            setup={setup}
            code={code}
            setCode={setCode}
            busy={busy}
            error={error}
            justPaired={justPaired}
            onVerify={verifyAndEnable}
            onLater={() => void finish()}
          />
        )}
      </div>
    </div>
  );
}

/* ----------------------------- stage 1: login ---------------------------- */

function CredentialsStage(props: {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  passwordRef: React.RefObject<HTMLInputElement>;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: (opts?: { skipCode?: boolean }) => Promise<void>;
}) {
  const { onSubmit } = props;
  return (
    <>
      <Header subtitle="Authorized Access Only · Muhammad Ibrahim" />

      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Labeled label="Admin Username">
          <input
            value={props.username}
            onChange={(e) => props.setUsername(e.target.value)}
            autoComplete="username"
            placeholder="admin"
            className={inputClass}
          />
        </Labeled>

        <Labeled label="Admin Password">
          <div className="relative">
            <input
              ref={props.passwordRef}
              type={props.showPassword ? 'text' : 'password'}
              value={props.password}
              onChange={(e) => props.setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••••"
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => props.setShowPassword(!props.showPassword)}
              aria-label={props.showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-bright"
            >
              {props.showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </Labeled>

        <Labeled label="Authenticator App Code (6 Digits)">
          <input
            value={props.code}
            onChange={(e) => props.setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]*"
            autoComplete="one-time-code"
            placeholder="000000"
            className={`${inputClass} text-center font-mono text-lg tracking-[0.5em]`}
          />
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
            Leave blank on your first login — you will be guided to pair your authenticator app.
          </p>
        </Labeled>

        {props.error ? <ErrorBox message={props.error} /> : null}

        <button
          type="submit"
          disabled={props.busy}
          className="mt-1 w-full rounded-lg px-4 py-2.5 text-[13px] font-bold text-[#0C0E1A] transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #FFD766)`, boxShadow: '0 0 24px rgba(245,179,1,0.35)' }}
        >
          {props.busy ? 'Verifying…' : '🔐 Sign In To Admin Portal'}
        </button>
      </form>
    </>
  );
}

/* ---------------------------- stage 2: pairing --------------------------- */

function PairingStage(props: {
  setup: SetupInfo | null;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  error: string | null;
  justPaired: boolean;
  onVerify: () => void;
  onLater: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const secret = props.setup?.secret ?? '';

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Header subtitle="Pair Your Authenticator App (2FA Setup)" />

      {props.justPaired ? (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-400">
          ✅ Authenticator verified and enabled.
        </div>
      ) : null}

      <div className="mt-4 flex justify-center">
        <div className="rounded-xl bg-white p-3">
          {props.setup ? (
            <QRCodeSVG value={props.setup.uri} size={180} />
          ) : (
            <div className="h-[180px] w-[180px] animate-pulse bg-gray-200" />
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          Manual Setup Secret Key
        </div>
        <div className="mt-1 flex items-center gap-2">
          <code className="mono-num flex-1 select-all break-all rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-text-bright">
            {secret || '—'}
          </code>
          <button
            type="button"
            onClick={() => void copySecret()}
            className="shrink-0 rounded border border-white/15 px-2 py-1.5 text-[10px] font-semibold text-text-secondary hover:border-white/30 hover:text-text-bright"
          >
            {copied ? '✅ Copied' : '📋 Copy Setup Key'}
          </button>
        </div>
      </div>

      <ol className="mt-4 space-y-1 text-[11px] leading-relaxed text-text-secondary">
        <li>1. Open Google Authenticator, Authy, or Microsoft Authenticator on your phone.</li>
        <li>2. Tap &lsquo;+&rsquo; and scan this QR code (or paste the Setup Key).</li>
        <li>3. Enter the 6-digit code shown in your app below to lock in 2FA.</li>
      </ol>

      <div className="mt-4">
        <input
          value={props.code}
          onChange={(e) => props.setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          maxLength={6}
          pattern="[0-9]*"
          autoComplete="one-time-code"
          placeholder="000000"
          className={`${inputClass} text-center font-mono text-lg tracking-[0.5em]`}
        />
      </div>

      {props.error ? <div className="mt-2"><ErrorBox message={props.error} /></div> : null}

      <button
        type="button"
        onClick={props.onVerify}
        disabled={props.busy}
        className="mt-3 w-full rounded-lg px-4 py-2.5 text-[13px] font-bold text-[#0C0E1A] transition-opacity disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${GOLD}, #FFD766)`, boxShadow: '0 0 24px rgba(245,179,1,0.35)' }}
      >
        {props.busy ? 'Verifying…' : '🔐 Verify Code & Enable Authenticator 2FA'}
      </button>

      {/* §2.3  Zero-lockout: pairing is opt-in. The admin can always walk into
          the portal and pair later. */}
      <button
        type="button"
        onClick={props.onLater}
        disabled={props.busy}
        className="mt-2 w-full rounded-lg border border-white/15 px-4 py-2 text-[11px] font-semibold text-text-secondary transition-colors hover:border-white/30 hover:text-text-bright disabled:opacity-50"
      >
        Enter Admin Portal Now &amp; Pair Later →
      </button>
    </>
  );
}

/* -------------------------------- shared -------------------------------- */

const inputClass =
  'w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-[13px] text-text-bright placeholder:text-text-muted/60 outline-none transition-colors focus:border-[#F5B301]/60';

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="text-center">
      <div
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl text-[20px]"
        style={{ background: 'linear-gradient(135deg, #F5B301, #FFD766)', boxShadow: '0 0 22px rgba(245,179,1,0.45)' }}
      >
        ⚡
      </div>
      <h1 className="mt-3 text-[15px] font-extrabold tracking-tight text-white">
        Alpha X Scanner — <span style={{ color: GOLD }}>Executive Admin Portal</span>
      </h1>
      <p className="mt-1 text-[10.5px] font-medium text-text-muted">{subtitle}</p>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-400"
    >
      {message}
    </div>
  );
}

function messageFor(error?: string): string {
  switch (error) {
    case 'BAD_CREDENTIALS':
      return 'Username or password is incorrect.';
    case 'NOT_ADMIN':
      return 'This account is not an administrator.';
    case 'SUSPENDED':
      return 'This administrator account is suspended.';
    case 'TOTP_REQUIRED':
      return 'Enter the 6-digit code from your authenticator app.';
    case 'BAD_CODE':
      return 'That code is not valid. Wait for the next code and try again.';
    case 'NO_SECRET':
      return 'No authenticator secret exists yet — reload to generate one.';
    case 'MISSING_FIELDS':
      return 'Enter your username and password.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

export { messageFor as adminAuthMessage };
