import { BRAND, LEGAL_EN } from '@/lib/constants';

/**
 * §1.2  Mandatory legal & non-affiliation disclaimer — English only.
 * The legacy Urdu paragraph was retired with the brand purge (§1.1).
 */
export function LegalFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="mt-4 border-t border-white/[0.06] px-4 py-3 text-center">
      <div className="mx-auto max-w-5xl space-y-2">
        {!compact ? (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
            <span className="font-bold text-text-secondary">{BRAND.productName}</span>
            <span aria-hidden="true">·</span>
            <span>{BRAND.domain.replace('https://', '')}</span>
            <span aria-hidden="true">·</span>
            <a
              href={BRAND.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mono-num select-all text-emerald-400 hover:underline"
            >
              {BRAND.whatsappContact}
            </a>
          </div>
        ) : null}

        <p className="mx-auto max-w-4xl text-[10px] leading-relaxed text-text-muted">{LEGAL_EN}</p>

        {!compact ? (
          <p className="text-[9.5px] text-text-muted/80">
            Monitoring Tag (⚠) is a risk warning, not a delisting confirmation. Always open the official Binance notice
            before making a decision.
          </p>
        ) : null}
      </div>
    </footer>
  );
}
