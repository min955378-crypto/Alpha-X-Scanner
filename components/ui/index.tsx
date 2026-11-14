'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/* -------------------------------------------------------------------------- */
/* §3.2  Copy mandate: every symbol, level, log line and license key must be   */
/*       selectable AND one-click copyable with a "Copied!" micro-tooltip.     */
/* -------------------------------------------------------------------------- */

export function CopyButton({
  value,
  label = 'Copy',
  className = '',
  compact = false,
}: {
  value: string;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for insecure contexts / older Android WebViews.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* give up silently */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }, [value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={copy}
        aria-label={`${label} ${value}`}
        className={`rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary hover:border-white/25 hover:text-white ${className}`}
      >
        {compact ? '⧉' : `⧉ ${label}`}
      </button>
      {copied ? (
        <span
          role="status"
          className="pointer-events-none absolute -top-6 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-emerald-500 px-1.5 py-0.5 text-[9.5px] font-bold text-black animate-fade-in"
        >
          Copied!
        </span>
      ) : null}
    </span>
  );
}

/** A selectable, copyable value chip — used for trade levels and license keys. */
export function CopyableValue({
  value,
  display,
  mono = true,
  className = '',
  copyLabel,
}: {
  value: string;
  display?: ReactNode;
  mono?: boolean;
  className?: string;
  copyLabel?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`${mono ? 'mono-num' : ''} select-all text-white`} data-copyable>
        {display ?? value}
      </span>
      <CopyButton value={value} label={copyLabel ?? 'Copy'} compact />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Pill                                                                        */
/* -------------------------------------------------------------------------- */

export type PillTone = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'gray' | 'orange';

const PILL_TONES: Record<PillTone, string> = {
  green: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  red: 'border-red-500/50 bg-red-500/10 text-red-400',
  amber: 'border-amber-500/55 bg-amber-500/10 text-amber-400',
  blue: 'border-blue-500/45 bg-blue-500/10 text-blue-400',
  purple: 'border-purple-500/50 bg-purple-500/10 text-purple-300',
  gray: 'border-slate-500/45 bg-slate-500/10 text-slate-300',
  orange: 'border-orange-500/50 bg-orange-500/10 text-orange-300',
};

export function Pill({
  tone = 'gray',
  children,
  className = '',
  title,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span title={title} className={`pill ${PILL_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Toggle                                                                      */
/* -------------------------------------------------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-[11.5px] text-text-secondary">{label}</span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors ${
          checked ? 'border-emerald-500/60 bg-emerald-500/30' : 'border-white/15 bg-white/[0.05]'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all ${
            checked ? 'left-[17px] bg-emerald-400' : 'left-[2px] bg-text-muted'
          }`}
        />
      </button>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        className="animate-fade-in relative w-full rounded-xl border border-white/10 bg-bg-card p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2">
          <h2 className="text-[13px] font-bold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-white" aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                           */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: 'xs' | 'sm';
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-white/10 bg-[#11141d]" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${size === 'xs' ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2 py-1 text-[10.5px]'} font-semibold transition-colors ${
            value === o.value ? 'bg-amber-500/20 text-amber-300' : 'text-text-secondary hover:bg-white/[0.05] hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Score meter (§7.1)                                                          */
/* -------------------------------------------------------------------------- */

export function ScoreMeter({ score, className = '' }: { score: number; className?: string }) {
  const tone = score >= 75 ? 'bg-emerald-500' : score >= 55 ? 'bg-amber-500' : 'bg-red-500';
  const textTone = score >= 75 ? 'text-emerald-400' : score >= 55 ? 'text-amber-400' : 'text-red-400';
  // 10 segments, each worth 10 points.
  const filled = Math.round(score / 10);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="flex gap-[2px]" aria-hidden="true">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className={`h-[9px] w-[5px] rounded-[1px] ${i < filled ? tone : 'bg-white/10'}`}
          />
        ))}
      </span>
      <span className={`mono-num text-[11px] font-bold ${textTone}`}>{score}/100</span>
    </span>
  );
}
