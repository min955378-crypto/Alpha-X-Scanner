'use client';

import { useState } from 'react';

import { LEGAL_EN, LEGAL_UR } from '@/lib/constants';
import { Modal } from '@/components/ui';

/**
 * §1.2  First-login onboarding modal. Both disclaimers must be acknowledged
 * before the terminal is usable; the acceptance is persisted to
 * `User.acceptedDisclaimerAt`.
 */
export function DisclaimerModal({ onAccept }: { onAccept: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Modal open onClose={() => undefined} title="Before you start — please read" width={620} closeOnBackdrop={false}>
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/[0.07] p-3">
          <p className="text-[11.5px] leading-relaxed text-text-bright">{LEGAL_EN}</p>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#11141d] p-3" dir="rtl">
          <p lang="ur" className="ur text-[12.5px] text-text-bright">
            {LEGAL_UR}
          </p>
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
            className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
          />
          <span>
            I have read and understood the English and Urdu disclaimers above. I understand this is an educational tool
            and not financial advice.
          </span>
        </label>

        <button
          type="button"
          disabled={!acknowledged}
          onClick={onAccept}
          className="w-full rounded-md bg-emerald-500/90 px-3 py-2 text-[12px] font-bold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-text-muted"
        >
          Accept &amp; enter the terminal
        </button>
      </div>
    </Modal>
  );
}
