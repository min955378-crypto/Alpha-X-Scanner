'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon, type IconName } from '@/components/ui/Icons';

/**
 * Shared primitives for the 9-module Admin Command Center.
 *
 * Same deep obsidian glass system as the customer terminal — #070A12 canvas,
 * #0E111A cards, Space Grotesk headings, JetBrains Mono numerals — so the
 * portal feels like one product rather than a bolted-on back office.
 */

/* --------------------------------- cards --------------------------------- */

export function Card({
  title,
  icon,
  subtitle,
  actions,
  children,
  accent,
  className = '',
}: {
  title: string;
  icon?: IconName;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** 2px semantic bottom border colour (MODULE 1 KPI cards). */
  accent?: string;
  className?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-3 py-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[12.5px] font-bold text-white">
            {icon ? <Icon name={icon} size={13} className="text-amber-400" /> : null}
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
      </header>
      <div style={accent ? { borderBottom: `2px solid ${accent}` } : undefined}>{children}</div>
    </section>
  );
}

/* ---------------------------------- KPI ---------------------------------- */

export function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'white',
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: IconName;
  tone?: 'white' | 'emerald' | 'amber' | 'red' | 'violet' | 'blue';
  onClick?: () => void;
}) {
  const tones: Record<string, { text: string; border: string; glow: string }> = {
    white: { text: '#FFFFFF', border: 'rgba(255,255,255,0.16)', glow: 'rgba(255,255,255,0.10)' },
    emerald: { text: '#22C55E', border: '#22C55E', glow: 'rgba(34,197,94,0.30)' },
    amber: { text: '#F5B301', border: '#F5B301', glow: 'rgba(245,179,1,0.30)' },
    /* §4.1  Split red: `#EF4444` is locked to the bear surfaces (candles, SHORT
       badges, --tile-extreme-border, .btn-red). Text uses the lighter
       `#F87171` for WCAG AA contrast. */
    red: { text: '#F87171', border: '#EF4444', glow: 'rgba(239,68,68,0.30)' },
    violet: { text: '#A78BFA', border: '#8B5CF6', glow: 'rgba(139,92,246,0.30)' },
    blue: { text: '#60A5FA', border: '#3B82F6', glow: 'rgba(59,130,246,0.30)' },
  };
  const t = tones[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="card group relative overflow-hidden p-3 text-left transition-transform duration-200 disabled:cursor-default enabled:hover:-translate-y-0.5"
      style={{ borderBottom: `2px solid ${t.border}`, boxShadow: `0 0 18px ${t.glow}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-text-muted">{label}</span>
        <Icon name={icon} size={14} style={{ color: t.text, filter: `drop-shadow(0 0 6px ${t.text})` }} />
      </div>
      <div className="mono-num mt-1.5 text-[22px] font-bold leading-none" style={{ color: t.text }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-[9.5px] leading-relaxed text-text-muted">{hint}</div> : null}
    </button>
  );
}

/* --------------------------------- button -------------------------------- */

export type BtnTone = 'ghost' | 'green' | 'red' | 'amber' | 'blue' | 'violet';

const BTN: Record<BtnTone, string> = {
  ghost: 'border-white/10 bg-white/[0.03] text-text-secondary hover:bg-white/[0.07] hover:text-white',
  green: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  red: 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20',
  amber: 'border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
  blue: 'border-blue-500/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20',
  violet: 'border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20',
};

export function Btn({
  children,
  onClick,
  tone = 'ghost',
  icon,
  disabled = false,
  busy = false,
  title,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: BtnTone;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border px-2 py-1 text-[10.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BTN[tone]} ${className}`}
    >
      {busy ? <Icon name="refresh" size={11} className="animate-spin" /> : icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </button>
  );
}

/* ---------------------------------- pill --------------------------------- */

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
    EXPIRED: 'border-red-500/50 bg-red-500/10 text-red-400',
    REVOKED: 'border-red-500/50 bg-red-500/10 text-red-400',
    UNASSIGNED: 'border-white/15 bg-white/[0.04] text-text-secondary',
    EXPIRING_SOON: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
    ADMIN: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
    USER: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
    Suspended: 'border-red-500/50 bg-red-500/10 text-red-400',
    Active: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  };
  const cls = map[status] ?? 'border-white/15 bg-white/[0.04] text-text-secondary';
  return <span className={`mono-num rounded-full border px-1.5 py-px text-[9px] font-bold ${cls}`}>{status}</span>;
}

/* --------------------------------- inputs -------------------------------- */

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-[9.5px] text-text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`input h-7 w-full ${mono ? 'mono-num' : ''}`}
    />
  );
}

/** Pill selector — used for duration presets, max-devices and filters. */
export function PillSelect<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
              on
                ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                : 'border-white/10 bg-white/[0.03] text-text-secondary hover:bg-white/[0.07]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------- modal -------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
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
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="card w-full p-4" style={{ maxWidth: width }}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-white" aria-label="Close">
            <Icon name="chevronDown" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- copy ---------------------------------- */

export function CopyBtn({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <button
      type="button"
      title={value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          /* Clipboard blocked — still show feedback so the UI isn't dead. */
        }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
      className="mono-num rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] font-semibold text-text-secondary hover:bg-white/[0.07] hover:text-white"
    >
      {copied ? 'Copied! ✓' : label}
    </button>
  );
}

/* --------------------------------- misc ---------------------------------- */

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-8 text-center text-[11px] text-text-muted">{children}</p>;
}

export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>{children}</div>;
}

/** Live countdown / absolute expiry used by the license table. */
export function formatExpiry(expiresAt: number | null, activatedAt: number | null): { text: string; tone: string } {
  if (expiresAt === null) {
    return activatedAt === null
      ? { text: 'Not started', tone: 'text-text-muted' }
      : { text: 'No expiry', tone: 'text-emerald-400' };
  }
  const ms = expiresAt - Date.now();
  if (ms <= 0) return { text: 'Expired', tone: 'text-red-400' };

  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;

  const tone = ms < 3 * 86_400_000 ? 'text-amber-400' : 'text-emerald-400';
  return { text, tone };
}
