'use client';

import { useState } from 'react';

import { BRAND } from '@/lib/constants';
import { Modal } from '@/components/ui';
import { Icon } from '@/components/ui/Icons';

/**
 * §1.5  Institutional disclaimer copy — strict Alpha X Scanner wording only.
 * No legacy brand names and no Urdu block (removed per the disclaimer audit).
 */
const DISCLAIMER_COPY =
  'Alpha X Scanner is an institutional market analysis and educational terminal. ' +
  'Cryptocurrency trading carries a high level of risk, and past performance or ' +
  'scanner signals do not guarantee future profits. Always verify market structure ' +
  'and official exchange notices before executing any trade.';

/**
 * §1.2  First-login onboarding modal.
 *
 * `onAccept` receives whether the user ticked "Don't remind me again". The
 * button is `type="button"` AND calls `preventDefault()` / `stopPropagation()`
 * so it can never submit a form, reload the page, or wipe in-memory auth state
 * (§1.1).
 */
export function DisclaimerModal({ onAccept }: { onAccept: (dontRemind: boolean) => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [dontRemind, setDontRemind] = useState(true);

  const enter = (e: React.MouseEvent<HTMLButtonElement>) => {
    // §1.1  Belt and braces: never let this bubble into a submit or a reload.
    e.preventDefault();
    e.stopPropagation();
    if (!acknowledged) return;
    onAccept(dontRemind);
  };

  return (
    <Modal
      open
      onClose={() => undefined}
      title="Before you start — please read"
      width={620}
      closeOnBackdrop={false}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/[0.07] p-3">
          <p className="text-[11.5px] leading-relaxed text-text-bright">{DISCLAIMER_COPY}</p>
        </div>

        <ul className="space-y-1.5 rounded-lg border border-white/[0.06] bg-bg-card-2 p-3 text-[11px] text-text-secondary">
          <li>
            • <strong className="text-white">Monitoring Tag (⚠)</strong> is a Binance risk warning — it is not a
            confirmation that a coin will be delisted.
          </li>
          <li>
            • No scanner, indicator or signal guarantees a profit. Every signal is scored 0–100 and includes an
            invalidation level.
          </li>
          <li>• Alpha X Scanner never asks for exchange API keys and cannot place trades.</li>
        </ul>

        <label className="flex cursor-pointer items-start gap-2 text-[11.5px] text-text-secondary">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
          />
          <span>I have read and understood the disclaimer above. I understand this is an educational tool and not financial advice.</span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-[11.5px] text-text-secondary">
          <input
            type="checkbox"
            checked={dontRemind}
            onChange={(e) => setDontRemind(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
          />
          <span>Don&apos;t remind me again on this device.</span>
        </label>

        <button
          type="button"
          disabled={!acknowledged}
          onClick={enter}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-[12px] font-bold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-text-muted"
        >
          <Icon name="check" size={14} />
          Enter the Terminal
        </button>

        <p className="text-center text-[10px] text-text-muted">
          Support · {BRAND.promoHeadline} ·{' '}
          <a
            href={BRAND.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mono-num text-emerald-400 hover:underline"
          >
            {BRAND.whatsappContact}
          </a>
        </p>
      </div>
    </Modal>
  );
}
