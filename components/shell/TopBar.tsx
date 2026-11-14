'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { BRAND } from '@/lib/constants';
import { licenseStatus } from '@/lib/license';
import { formatClock } from '@/lib/format';
import { SCANNERS } from '@/lib/types';
import { Icon } from '@/components/ui/Icons';
import { useAdminShortcut } from '@/components/shell/useAdminShortcut';
import { useAuth } from '@/components/providers/AuthProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useMarket } from '@/components/providers/MarketProvider';

/**
 * §5.1  Global top bar — 32px, sticky, #0C0E1A.
 */
export function TopBar() {
  const { user, systemConfig, logout } = useAuth();
  const { settings } = useSettings();
  const { status, dataMode } = useMarket();
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);

  /* §1.1  Customers never see any admin affordance; admins get the glowing
     amber Command Center button plus the Ctrl/Cmd+Shift+A toggle. */
  const isAdmin = user?.role === 'ADMIN';
  const onAdminRoute = pathname === '/admin';
  useAdminShortcut(isAdmin === true, onAdminRoute, router);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = now ? formatClock(now, settings.timezone, settings.clock24) : '—';
  const nyLeft = useMemo(() => countdownToNyClose(now), [now]);

  const connectionLabel =
    status === 'connected'
      ? 'Connected'
      : status === 'cached'
        ? 'Cached (Reconnecting...)'
        : status === 'connecting'
          ? 'Syncing...'
          : 'Offline';

  const connectionTone =
    status === 'connected' ? 'text-emerald-400' : status === 'offline' ? 'text-red-400' : 'text-amber-400';
  const dotTone =
    status === 'connected' ? 'bg-emerald-500' : status === 'offline' ? 'bg-red-500' : 'bg-amber-500';

  /* §2  One active license key unlocks 100% of the platform, so every scanner
     reports Active. The only thing that can degrade is license status. */
  const licence = licenseStatus(user, now?.getTime() ?? Date.now());

  return (
    <header className="sticky top-0 z-50 flex h-topbar items-center justify-between gap-2 border-b border-white/[0.06] bg-bg-topbar px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-1.5 font-extrabold tracking-tight text-white">
          <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          <span className="text-[13px]">Alpha X Scanner</span>
        </Link>

        <span className="hidden shrink-0 rounded border border-emerald-500/45 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-400 sm:inline">
          {systemConfig.versionBadge}
        </span>

        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-secondary" role="status" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${dotTone} ${status === 'connected' ? 'animate-pulse' : ''}`} />
          <span className={connectionTone}>{connectionLabel}</span>
        </span>

        {dataMode === 'SIMULATED' ? (
          <span
            title="Binance is unreachable from this environment, so the engine is running the deterministic synthetic feed. All indicator math is identical."
            className="hidden shrink-0 rounded border border-amber-500/45 bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-400 lg:inline"
          >
            SIM FEED
          </span>
        ) : null}

        {/* §5.1  "Your access" dropdown */}
        <div className="group relative shrink-0">
          <button
            type="button"
            aria-haspopup="true"
            className="rounded border border-emerald-500/55 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
          >
            Alpha X Pro ▾
          </button>
          <div className="absolute left-0 top-full z-50 hidden w-60 rounded-lg border border-white/10 bg-bg-card p-3 shadow-2xl group-hover:block group-focus-within:block">
            <div className="mb-2 border-b border-white/5 pb-1.5 text-[11px] font-bold text-white">Your access</div>
            <ul className="space-y-1.5 text-[11px]">
              {SCANNERS.map((s) => (
                <li key={s.slug} className="flex items-center justify-between gap-2">
                  <span className="text-gray-200">{s.name}</span>
                  <span
                    className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-1.5 py-px text-[9.5px] font-bold text-emerald-400"
                    style={{ filter: 'drop-shadow(0 0 6px rgba(0, 210, 106, 0.45))' }}
                  >
                    Active
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 space-y-1 border-t border-white/5 pt-2 text-[10px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">License</span>
                <span
                  className={`mono-num font-bold ${
                    licence.state === 'EXPIRED' || licence.state === 'SUSPENDED'
                      ? 'text-red-400'
                      : licence.state === 'EXPIRING'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {licence.badge}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Validity</span>
                <span className="mono-num font-semibold text-text-bright">{licence.remaining}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">Key</span>
                <span className="mono-num select-all font-semibold text-text-bright">
                  {user?.licenseKey ?? '—'}
                </span>
              </div>
              <p className="pt-0.5 text-[9.5px] leading-relaxed text-text-muted">
                All five scanners unlocked by your active license key.
              </p>
            </div>
            <a
              href={BRAND.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mono-num mt-1.5 block select-all text-[10px] font-semibold text-emerald-400 hover:underline"
            >
              {licence.active ? 'Renew / extend' : 'Renew now'} · {systemConfig.whatsappContact}
            </a>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden items-center gap-1.5 rounded-full border border-blue-500/45 bg-blue-500/10 px-2.5 py-0.5 text-[10px] md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          <span className="font-medium text-blue-400">New York</span>
          <span className="mono-num text-text-secondary">{nyLeft}</span>
        </div>

        <span className="mono-num text-[11px] font-medium text-white" title={`Local time (${settings.timezone})`}>
          {clock}
        </span>

        {isAdmin ? (
          onAdminRoute ? (
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 rounded border border-emerald-500/55 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
            >
              <Icon name="external" size={11} />
              <span className="hidden sm:inline">Live Trading Terminal</span>
              <span className="sm:hidden">Terminal</span>
            </Link>
          ) : (
            <Link
              href="/admin"
              title="Admin Command Center (Ctrl + Shift + A)"
              className="group relative flex items-center gap-1.5 overflow-hidden rounded border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 transition-colors hover:bg-amber-400/20"
              style={{ boxShadow: '0 0 12px rgba(245, 179, 1, 0.28)' }}
            >
              <Icon name="shieldAlert" size={11} className="text-amber-300" />
              <span className="hidden sm:inline">Command Center</span>
              <span className="sm:hidden">Admin</span>
              <kbd className="mono-num hidden rounded border border-amber-400/40 px-1 text-[8.5px] font-semibold text-amber-300/80 lg:inline">
                ⌘⇧A
              </kbd>
            </Link>
          )
        ) : null}

        <button
          type="button"
          onClick={async () => {
            await logout();
            router.push('/login');
          }}
          className="rounded border border-red-500/55 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400 hover:bg-red-500/20"
        >
          Logout
        </button>
      </div>
    </header>
  );
}

/**
 * §5.1  Countdown to the New York session close (17:00 America/New_York), which
 * doubles as the daily reset boundary. Recomputed every minute.
 */
function countdownToNyClose(now: Date | null): string {
  if (!now) return '—';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const minutesNow = (hour % 24) * 60 + minute;
    const closeAt = 17 * 60;
    let diff = closeAt - minutesNow;
    if (diff < 0) diff += 24 * 60;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h ${m}m left`;
  } catch {
    return '—';
  }
}
