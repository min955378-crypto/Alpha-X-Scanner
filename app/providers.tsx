'use client';

import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/providers/ToastProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { MarketProvider } from '@/components/providers/MarketProvider';

/**
 * Provider order matters: Auth resolves the session first so the market socket
 * can be opened with the user's preferred timeframe and entitlements.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <SettingsProvider>
          <MarketProvider>{children}</MarketProvider>
        </SettingsProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
