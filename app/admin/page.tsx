'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { AppShell } from '@/components/shell/AppShell';
import { AdminPortal } from '@/components/admin/AdminPortal';
import { useAuth } from '@/components/providers/AuthProvider';

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
