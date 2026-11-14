'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * §1.1  Ctrl + Shift + A (Cmd + Shift + A on macOS) toggles between
 * `/dashboard` and `/admin`.
 *
 * Registered ONLY when the caller passes `enabled` — i.e. only for ADMIN
 * sessions — so a customer's browser never even has the listener attached.
 *
 * The shortcut is suppressed while typing so an admin composing a username or
 * a broadcast message doesn't get yanked out of the form.
 */
export function useAdminShortcut(enabled: boolean, onAdminRoute: boolean, router: ReturnType<typeof useRouter>): void {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 'A' && e.key !== 'a') return;

      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;

      e.preventDefault();
      router.push(onAdminRoute ? '/dashboard' : '/admin');
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onAdminRoute, router]);
}
