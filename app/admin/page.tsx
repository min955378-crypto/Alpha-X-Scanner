'use client';

import { AppShell } from '@/components/shell/AppShell';
import { AdminPortal } from '@/components/admin/AdminPortal';
import { AdminAuthGate } from '@/components/admin/AdminAuthGate';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * §1.1  `/admin` NEVER redirects.
 *
 * Previously this route called `router.replace('/dashboard')` for a non-admin,
 * which bounced the owner to the customer terminal — and, combined with the
 * per-instance random session secret (§1.2), did so intermittently whenever a
 * request landed on a freshly-booted serverless instance.
 *
 * The route now has exactly three states and all three stay put:
 *
 *   1. Session hydrating      -> obsidian skeleton loader
 *   2. No authenticated ADMIN -> the dedicated Admin Sign-In gate, in place
 *   3. Authenticated ADMIN    -> the 9-module portal
 *
 * State 2 covers both "logged out" and "logged in as a customer/demo". It
 * previously fell through to the portal for a logged-out visitor, which leaked
 * the admin shell to anyone who hit the URL directly.
 */
export default function AdminPage() {
  const { user, loading } = useAuth();

  if (loading) return <AdminBootSkeleton />;

  /* Only a live ADMIN session reaches the portal. Everyone else — anonymous
     visitors included — gets the sign-in gate right here on /admin. */
  if (!user || user.role !== 'ADMIN') return <AdminAuthGate />;

  return (
    <AppShell>
      <main className="min-w-0 flex-1 p-3">
        <AdminPortal />
      </main>
    </AppShell>
  );
}

/**
 * §1.1  Sleek dark obsidian loader shown while the session resolves.
 *
 * Deliberately on-brand and informative rather than a blank canvas: the old
 * guard rendered an empty div during hydration, so a slow session looked
 * exactly like a broken page.
 */
function AdminBootSkeleton() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#070913]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 50% 40%, rgba(245,179,1,0.10), transparent 60%)',
        }}
      />

      <div
        className="relative flex h-12 w-12 items-center justify-center rounded-xl text-[22px]"
        style={{
          background: 'linear-gradient(135deg, #F5B301, #FFD766)',
          boxShadow: '0 0 28px rgba(245,179,1,0.45)',
          animation: 'ax-admin-pulse 1.6s ease-in-out infinite',
        }}
      >
        ⚡
      </div>

      <p className="relative text-[12px] font-semibold tracking-wide text-text-secondary">
        Initializing Alpha X Admin Command Center…
      </p>

      <div className="relative h-0.5 w-48 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full w-1/3 rounded-full"
          style={{
            background: 'linear-gradient(90deg, transparent, #F5B301, transparent)',
            animation: 'ax-admin-sweep 1.2s linear infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes ax-admin-pulse {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes ax-admin-sweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
