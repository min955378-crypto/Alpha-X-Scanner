'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuroraBackground } from '@/components/ui/Motion3D';
import { Icon, type IconName } from '@/components/ui/Icons';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { TABS, TabBar, BottomNav } from './TabBar';
import { TopBar } from './TopBar';
import { LegalFooter } from './LegalFooter';
import { DisclaimerModal } from './DisclaimerModal';
import { useAuth } from '@/components/providers/AuthProvider';
import { useMarket } from '@/components/providers/MarketProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { Modal } from '@/components/ui';

/**
 * §5  Global app shell: 32px top bar + 36px tab bar + content + legal footer.
 * Owns the auth guard, the first-login disclaimer and the §13 keyboard map.
 */
export function AppShell({
  children,
  rightSidebar,
  onCloseSidebar,
}: {
  children: ReactNode;
  rightSidebar?: ReactNode;
  onCloseSidebar?: () => void;
}) {
  const { user, loading, refresh } = useAuth();
  const { boot, setTimeframe, timeframe } = useMarket();
  const { settings, hydrated } = useSettings();
  const router = useRouter();
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!user.acceptedDisclaimerAt) setShowDisclaimer(true);
  }, [loading, user, router]);

  // Keep the market socket on the timeframe this user saved in /settings.
  useEffect(() => {
    if (hydrated && settings.timeframe !== timeframe) setTimeframe(settings.timeframe);
  }, [hydrated, settings.timeframe, timeframe, setTimeframe]);

  const acceptDisclaimer = useCallback(async () => {
    await fetch('/api/user/disclaimer', { method: 'POST' });
    setShowDisclaimer(false);
    await refresh();
  }, [refresh]);

  /* §13  Keyboard shortcuts: 1-7 switch tabs, "/" focuses search. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        const input = document.querySelector<HTMLInputElement>('[data-search-input]');
        if (input) {
          e.preventDefault();
          input.focus();
        }
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TABS.length) {
        e.preventDefault();
        router.push(TABS[n - 1].href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const booting = boot && !boot.phaseAReady;

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-bg-0">
      {/* §Phase 2 §2.2 — 60fps 3D perspective grid + volumetric orbs. */}
      <AuroraBackground />
      <div className="relative z-10 flex min-h-screen flex-col dash-tint">
      <TopBar />
      <TabBar right={<TabUtilities />} onOpenSidebar={rightSidebar ? () => setDrawerOpen(true) : undefined} />

      {booting ? (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-1.5 text-[11px] text-amber-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          <span className="mono-num">
            Phase A cold start — seeding {boot?.seeded ?? 0}/{boot?.total ?? 0} coins · weight{' '}
            {boot?.weightUsedMin ?? 0}/1200 per min
          </span>
          <div className="ml-2 h-1 w-40 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-amber-400 transition-all"
              style={{ width: `${boot?.total ? (boot.seeded / boot.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* §6  Desktop: grid-cols-[1fr_190px]. <1024px: the sidebar becomes a
              slide-over drawer (§13). */}
      <div className="flex flex-1 pb-16 md:pb-0">
        {children}
        {rightSidebar ? (
          <div className="hidden w-sidebar shrink-0 border-l border-white/[0.06] p-3 lg:block">{rightSidebar}</div>
        ) : null}
      </div>

      <LegalFooter />

      {rightSidebar ? (
        <Modal
          open={drawerOpen}
          onClose={() => {
            setDrawerOpen(false);
            onCloseSidebar?.();
          }}
          title="Top movers & chart settings"
          width={300}
        >
          {rightSidebar}
        </Modal>
      ) : null}

      <BottomNav />
      {showDisclaimer ? <DisclaimerModal onAccept={acceptDisclaimer} /> : null}
      </div>
    </div>
  );
}

/** §5.2  Right-side utility triggers on the tab bar. */
function TabUtilities() {
  const pathname = usePathname();
  const dashboard = pathname.startsWith('/dashboard');
  const items = dashboard
    ? [
        { href: '/dashboard?view=table', label: 'Pro Table', icon: 'table' as IconName },
        { href: '/dashboard?view=finder', label: 'Coin Finder', icon: 'search' as IconName },
        { href: '/dashboard?view=watchlist', label: 'Watchlist', icon: 'star' as IconName },
      ]
    : [
        { href: '/dashboard?view=table', label: 'Pro Table', icon: 'table' as IconName },
        { href: '/dashboard?view=finder', label: 'Coin Finder', icon: 'search' as IconName },
      ];

  return (
    <>
      <div className="hidden items-center gap-1.5 xl:flex">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="btn-ghost whitespace-nowrap">
            <Icon name={it.icon} size={12} /> {it.label}
          </Link>
        ))}
      </div>
      <Link href="/tutorials" className="btn-ghost inline-flex items-center gap-1.5 whitespace-nowrap" title="Tutorial hub">
        <Icon name="book" size={13} /> Tutorials
      </Link>
      <Link href="/settings" className="btn-ghost inline-flex items-center" title="Settings" aria-label="Settings">
        <Icon name="settings" size={14} />
      </Link>
    </>
  );
}
