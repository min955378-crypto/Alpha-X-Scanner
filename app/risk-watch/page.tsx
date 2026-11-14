'use client';

import { AppShell } from '@/components/shell/AppShell';
import { RiskWatchView } from '@/components/riskwatch/RiskWatchView';

export default function RiskWatchPage() {
  return (
    <AppShell>
      <main className="min-w-0 flex-1 p-3">
        <RiskWatchView />
      </main>
    </AppShell>
  );
}
