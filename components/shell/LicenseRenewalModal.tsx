'use client';

import { useEffect, useState } from 'react';

import { BRAND } from '@/lib/constants';
import { licenseStatus, type LicenseState } from '@/lib/license';
import { useAuth } from '@/components/providers/AuthProvider';
import { Icon } from '@/components/ui/Icons';

/**
 * §1.2 / §2  License Expired & Renewal modal.
 *
 * Scanner tabs are never locked, so this is the ONLY gate left in the product:
 * it appears when a key is expired, revoked or about to lapse, and every CTA
 * points at the single canonical WhatsApp deep link for Muhammad Ibrahim.
 *
 * Dismissal is remembered per-day under `alphax:v2:renewal_dismissed` so an
 * expiring key nudges once per day rather than on every navigation.
 */

const DISMISS_KEY = 'alphax:v2:renewal_dismissed';

/** States that warrant interrupting the user. */
function shouldShow(state: LicenseState): boolean {
  return state === 'EXPIRED' || state === 'EXPIRING' || state === 'SUSPENDED' || state === 'NONE';
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(day: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, day);
  } catch {
    /* private mode — the modal simply reappears next session */
  }
}

export function LicenseRenewalModal() {
  const { user } = useAuth();
  const [now, setNow] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  /* `now` is null until mount so the server and first client render agree. */
  useEffect(() => {
    setNow(Date.now());
    setDismissed(readDismissed());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!user || now === null) return null;

  const licence = licenseStatus(user, now);
  if (!shouldShow(licence.state)) return null;

  const today = new Date(now).toISOString().slice(0, 10);
  /* An expired key is never dismissible — scanning is genuinely blocked. */
  const dismissible = licence.state !== 'EXPIRED' && licence.state !== 'SUSPENDED';
  if (dismissed === today) return null;

  const hardBlocked = licence.state === 'EXPIRED' || licence.state === 'SUSPENDED';

  const heading =
    licence.state === 'EXPIRED'
      ? 'Your license has expired'
      : licence.state === 'SUSPENDED'
        ? 'Your account is suspended'
        : licence.state === 'NONE'
          ? 'No license key bound'
          : 'Your license expires soon';

  const body =
    licence.state === 'EXPIRED'
      ? 'Live scanning is paused until the key is renewed. Your watchlists, settings and saved layouts are untouched.'
      : licence.state === 'SUSPENDED'
        ? 'Access has been suspended by the administrator. Contact Muhammad Ibrahim to restore your terminal.'
        : licence.state === 'NONE'
          ? 'Bind a license key to unlock live scanning across all five institutional scanners.'
          : `Only ${licence.remaining} remain on your current key. Renew now so your sessions are never interrupted.`;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="renewal-title"
    >
      <div className="card w-full max-w-md overflow-hidden p-5 text-center">
        <div
          className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl border ${
            hardBlocked
              ? 'border-red-500/45 bg-red-500/10 text-red-400'
              : 'border-amber-500/45 bg-amber-500/10 text-amber-400'
          }`}
          style={{ filter: 'drop-shadow(0 0 10px currentColor)' }}
        >
          <Icon name={hardBlocked ? 'shieldAlert' : 'clock'} size={22} />
        </div>

        <h2 id="renewal-title" className="mt-3 text-[16px] font-bold text-white">
          {heading}
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-text-secondary">{body}</p>

        {licence.expiresAt ? (
          <p className="mono-num mt-2 text-[10.5px] text-text-muted">
            {user.licenseKey ?? '—'} · expires {new Date(licence.expiresAt).toISOString().slice(0, 10)}
          </p>
        ) : null}

        <a
          href={BRAND.whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-green mt-4 w-full justify-center"
        >
          <Icon name="whatsapp" size={14} />
          Get License Key — Contact {BRAND.brandWatermark} ({BRAND.whatsappContact})
        </a>

        {dismissible ? (
          <button
            type="button"
            onClick={() => {
              writeDismissed(new Date().toISOString().slice(0, 10));
              setDismissed(new Date().toISOString().slice(0, 10));
            }}
            className="mt-2 w-full rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-white/[0.05]"
          >
            Remind me tomorrow
          </button>
        ) : (
          <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
            This notice clears automatically once your renewed key is active.
          </p>
        )}
      </div>
    </div>
  );
}
