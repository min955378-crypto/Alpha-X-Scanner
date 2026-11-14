'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SCANNERS } from '@/lib/types';

export interface NavTab {
  href: string;
  label: string;
  emoji: string;
  /** Amber active treatment, per §5.2 for Binance Risk Watch. */
  accent?: 'green' | 'amber';
}

export const TABS: NavTab[] = [
  { href: '/dashboard', label: 'Dashboard', emoji: '🏠' },
  ...SCANNERS.map((s) => ({ href: `/scanners/${s.slug}`, label: s.name, emoji: s.emoji })),
  { href: '/risk-watch', label: 'Binance Risk Watch', emoji: '⚠', accent: 'amber' as const },
];

/**
 * §5.2  Primary 7-tab navigation — 36px. Collapses to a 5-item bottom nav
 * below 768px (§13).
 */
export function TabBar({
  right,
  onOpenSidebar,
}: {
  right?: React.ReactNode;
  onOpenSidebar?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="sticky top-topbar z-40 flex h-tabbar items-center justify-between gap-3 overflow-x-auto border-b border-white/[0.06] bg-bg-topbar px-3 lg:px-6"
    >
      <div className="flex shrink-0 items-center gap-4 text-[11.5px] lg:gap-5">
        {TABS.map((tab) => {
          const active = pathname === tab.href || (tab.href !== '/dashboard' && pathname.startsWith(tab.href));
          const amber = tab.accent === 'amber';
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-tabbar shrink-0 items-center gap-1.5 border-b-2 font-semibold transition-colors ${
                active
                  ? amber
                    ? 'border-amber-400 text-amber-400'
                    : 'border-emerald-400 text-white'
                  : amber
                    ? 'border-transparent text-text-secondary hover:text-amber-400'
                    : 'border-transparent text-text-secondary hover:text-white'
              }`}
            >
              <span aria-hidden="true">{tab.emoji}</span>
              <span className="whitespace-nowrap">{tab.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
        {onOpenSidebar ? (
          <button type="button" onClick={onOpenSidebar} className="btn-ghost lg:hidden">
            🔥 Movers &amp; TF
          </button>
        ) : null}
        {right}
      </div>
    </nav>
  );
}

/** §13  Sticky 5-item bottom navigation for ≤768px, with 44×44px targets. */
export function BottomNav({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const pathname = usePathname();
  const items: Array<{ href: string; label: string; emoji: string }> = [
    { href: '/dashboard?view=heatmap', label: 'Heatmap', emoji: '🏠' },
    { href: '/scanners/v1-scaling', label: 'Scanners', emoji: '🎯' },
    { href: '/dashboard?view=finder', label: 'Finder', emoji: '🔍' },
    { href: '/risk-watch', label: 'Risk Watch', emoji: '⚠' },
    { href: '/settings', label: 'Me/TF', emoji: '⚙' },
  ];

  return (
    <nav
      aria-label="Primary mobile"
      className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-5 border-t border-white/10 bg-bg-topbar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((it) => {
        const base = it.href.split('?')[0];
        const active = pathname === base;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[52px] flex-col items-center justify-center gap-0.5 text-[9.5px] font-semibold ${
              active ? 'text-amber-400' : 'text-text-muted'
            }`}
          >
            <span aria-hidden="true" className="text-[15px] leading-none">
              {it.emoji}
            </span>
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
