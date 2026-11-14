'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { AppShell } from '@/components/shell/AppShell';
import { AdminPortal } from '@/components/admin/AdminPortal';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * §1.1  STEALTH ADMIN ROUTE.
 *
 * A non-admin must never see a single admin pixel. The guard renders an empty
 * canvas (not a spinner, not a redirect message) while the session resolves,
 * so there is zero admin UI flash before `router.replace('/dashboard')`.
 */
export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== 'ADMIN') router.replace('/dashboard');
  }, [loading, user, router]);

  if (loading) return <div className="min-h-screen bg-bg-canvas" />;
  if (user && user.role !== 'ADMIN') return <div className="min-h-screen bg-bg-canvas" />;

  return (
    <AppShell>
      <main className="min-w-0 flex-1 p-3">
        <AdminPortal />
      </main>
    </AppShell>
  );
}
