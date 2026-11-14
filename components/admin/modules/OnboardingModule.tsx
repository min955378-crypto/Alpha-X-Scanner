'use client';

import { useState } from 'react';

import { BRAND } from '@/lib/constants';
import { Icon } from '@/components/ui/Icons';
import { Btn, Card, CopyBtn, Field, PillSelect, TextInput } from '../shared';

/**
 * MODULE 2  1-Click Customer + License Onboarding Studio.
 *
 * Goal: Muhammad Ibrahim registers a paying customer and hands over their
 * credentials on WhatsApp in under 10 seconds. One form, one atomic API call,
 * and a ready-to-deliver card with copy + WhatsApp buttons.
 */

const DURATIONS = [
  { value: 1, label: '24h Demo' },
  { value: 7, label: '7d Trial' },
  { value: 30, label: '30d Monthly' },
  { value: 90, label: '90d Quarterly' },
  { value: 180, label: '180d Semi-Annual' },
  { value: 365, label: '365d Annual' },
  { value: 3650, label: 'Lifetime (3650d)' },
];

const DEVICE_OPTIONS = [
  { value: 1, label: '1 Device' },
  { value: 2, label: '2 Devices' },
  { value: 5, label: '5 Devices' },
  { value: 99, label: 'Unlimited (99)' },
];

interface Credentials {
  username: string;
  password: string;
  licenseKey: string;
  durationDays: number;
  maxDevices: number;
  expiresAt: number | null;
  whatsappNumber: string | null;
}

const SCANNER_NAMES = ['V1 Scaling', 'Order Block', 'EMA Crossover', 'Hidden Bullish', 'Alpha Sniper'];

function randomUsername(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `client${n}`;
}

/** 14-char password: unambiguous alphabet, guaranteed upper/lower/digit. */
function strongPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  for (let i = chars.length; i < 14; i += 1) chars.push(pick(all));
  /* Fisher–Yates so the guaranteed characters aren't always first. */
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Normalise 03001234567 / +923001234567 / 923001234567 → 923001234567. */
export function toWhatsAppIntl(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('92') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return `92${digits.slice(1)}`;
  if (digits.length === 10) return `92${digits}`;
  return digits;
}

function buildWelcomeMessage(c: Credentials, origin: string): string {
  return [
    '🚀 *WELCOME TO ALPHA X SCANNER PRO* 🚀',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `👤 *Username:* ${c.username}`,
    `🔐 *Password:* ${c.password}`,
    `🔑 *License Key:* ${c.licenseKey}`,
    `⏳ *Validity:* ${c.durationDays} Days (Full Access — All 5 Scanners Unlocked)`,
    `💻 *Max Devices:* ${c.maxDevices === 99 ? 'Unlimited' : c.maxDevices}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    `🌐 *Login Terminal:* ${origin}/login`,
    `📞 *Support:* ${BRAND.brandWatermark} (${BRAND.whatsappContact})`,
  ].join('\n');
}

export function OnboardingModule() {
  const [username, setUsername] = useState(() => randomUsername());
  const [password, setPassword] = useState(() => strongPassword());
  const [whatsapp, setWhatsapp] = useState('');
  const [duration, setDuration] = useState(30);
  const [customDays, setCustomDays] = useState('');
  const [maxDevices, setMaxDevices] = useState(5);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const effectiveDays = customDays.trim() ? Math.max(1, Math.min(3650, Number(customDays) || 30)) : duration;

  const reset = () => {
    setUsername(randomUsername());
    setPassword(strongPassword());
    setWhatsapp('');
    setCustomDays('');
    setCreds(null);
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          whatsappNumber: whatsapp.trim() || null,
          durationDays: effectiveDays,
          maxDevices,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; credentials?: Credentials };
      if (!json.ok || !json.credentials) {
        setError(ERROR_COPY[json.error ?? 'UNKNOWN'] ?? 'Could not create the customer. Please retry.');
        return;
      }
      setCreds(json.credentials);
    } catch {
      setError('Network error — the customer was not created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
      {/* ------------------------------- form ------------------------------- */}
      <Card
        title="Customer Onboarding Studio"
        icon="user"
        subtitle="Creates the account, mints a bound APS key and starts the validity clock atomically."
      >
        <div className="space-y-3 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer Username">
              <div className="flex gap-1.5">
                <TextInput value={username} onChange={setUsername} placeholder="client4821" mono />
                <Btn icon="refresh" onClick={() => setUsername(randomUsername())} title="Auto-generate">
                  🎲
                </Btn>
              </div>
            </Field>

            <Field label="Customer Password">
              <div className="flex gap-1.5">
                <TextInput value={password} onChange={setPassword} placeholder="strong password" mono />
                <Btn icon="key" onClick={() => setPassword(strongPassword())} title="Generate strong password">
                  🎲
                </Btn>
              </div>
            </Field>
          </div>

          <Field label="Customer WhatsApp Number" hint="Optional — enables the 1-tap delivery button.">
            <TextInput value={whatsapp} onChange={setWhatsapp} placeholder="03001234567 or +923001234567" mono />
          </Field>

          <Field label="License Duration Preset">
            <PillSelect options={DURATIONS} value={duration} onChange={(v) => { setDuration(v); setCustomDays(''); }} />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-text-muted">Custom days</span>
              <input
                type="number"
                min={1}
                max={3650}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                placeholder="e.g. 45"
                className="input mono-num h-7 w-28"
              />
              <span className="mono-num text-[10px] text-amber-400">effective: {effectiveDays} days</span>
            </div>
          </Field>

          <Field label="Max Allowed Devices">
            <PillSelect options={DEVICE_OPTIONS} value={maxDevices} onChange={setMaxDevices} />
          </Field>

          <Field label="Scanner Access" hint="All five scanners are always granted — Alpha X Pro no longer sells individual tabs.">
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {SCANNER_NAMES.map((n) => (
                <span
                  key={n}
                  className="flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-400"
                >
                  <Icon name="check" size={10} />
                  {n}
                </span>
              ))}
            </div>
          </Field>

          {error ? (
            <p className="rounded border border-red-500/40 bg-red-500/[0.07] px-2.5 py-1.5 text-[11px] text-red-400">{error}</p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            <Btn tone="green" icon="bolt" busy={busy} onClick={submit}>
              ⚡ Create Customer &amp; Mint Bound License Key
            </Btn>
            <Btn icon="reset" onClick={reset}>
              Clear
            </Btn>
          </div>
        </div>
      </Card>

      {/* --------------------------- delivery card -------------------------- */}
      <div>
        {creds ? (
          <CredentialsCard creds={creds} onAnother={reset} />
        ) : (
          <Card title="Ready-to-Deliver Credentials" icon="key" subtitle="Appears here the moment the customer is created.">
            <p className="px-3 py-8 text-center text-[11px] text-text-muted">
              Fill the form and click <span className="font-semibold text-amber-400">⚡ Create Customer</span>.
              <br />
              The generated card is copy-ready for WhatsApp.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function CredentialsCard({ creds, onAnother }: { creds: Credentials; onAnother: () => void }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const message = buildWelcomeMessage(creds, origin);
  const intl = toWhatsAppIntl(creds.whatsappNumber);
  const waHref = intl
    ? `https://wa.me/${intl}?text=${encodeURIComponent(message)}`
    : null;

  return (
    <div className="card overflow-hidden" style={{ boxShadow: '0 0 24px rgba(245,179,1,0.18)' }}>
      <header className="flex items-center gap-2 border-b border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
        <Icon name="check" size={13} className="text-emerald-400" />
        <h3 className="text-[12px] font-bold text-amber-300">Customer Created — Ready to Deliver</h3>
      </header>

      <pre className="mono-num max-h-[300px] overflow-auto whitespace-pre-wrap border-b border-white/[0.06] bg-black/40 p-3 text-[10.5px] leading-relaxed text-text-bright">
        {message}
      </pre>

      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-bg-card-2 px-2 py-1">
          <span className="text-[10px] text-text-muted">Username</span>
          <span className="flex items-center gap-1.5">
            <span className="mono-num text-[11px] font-semibold text-white">{creds.username}</span>
            <CopyBtn value={creds.username} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-bg-card-2 px-2 py-1">
          <span className="text-[10px] text-text-muted">Password</span>
          <span className="flex items-center gap-1.5">
            <span className="mono-num text-[11px] font-semibold text-white">{creds.password}</span>
            <CopyBtn value={creds.password} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-bg-card-2 px-2 py-1">
          <span className="text-[10px] text-text-muted">License Key</span>
          <span className="flex items-center gap-1.5">
            <span className="mono-num text-[11px] font-semibold text-emerald-400">{creds.licenseKey}</span>
            <CopyBtn value={creds.licenseKey} />
          </span>
        </div>

        <div className="flex flex-col gap-1.5 pt-1.5">
          <CopyAllButton message={message} />
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-green w-full justify-center"
            >
              <Icon name="whatsapp" size={12} />
              Send Directly to Customer on WhatsApp ↗
            </a>
          ) : (
            <p className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] text-text-muted">
              No WhatsApp number saved — add one before creating to enable 1-tap delivery.
            </p>
          )}
          <Btn icon="user" onClick={onAnother} className="w-full">
            ➕ Onboard Another Customer
          </Btn>
        </div>
      </div>
    </div>
  );
}

function CopyAllButton({ message }: { message: string }) {
  return <CopyBtn value={message} label="📋 Copy Welcome Message" />;
}

const ERROR_COPY: Record<string, string> = {
  USERNAME_TAKEN: 'That username already exists. Generate a different one.',
  MISSING_FIELDS: 'Username and password are both required.',
  PASSWORD_TOO_SHORT: 'Password must be at least 6 characters.',
  BAD_USERNAME: 'Username may only use letters, numbers, dot, dash and underscore (3–32 chars).',
  ONBOARD_FAILED: 'Onboarding failed and was rolled back — nothing was created.',
  FORBIDDEN: 'Admin access required.',
};
