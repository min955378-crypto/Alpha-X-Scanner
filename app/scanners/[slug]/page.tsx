'use client';

import { useParams } from 'next/navigation';

import { AppShell } from '@/components/shell/AppShell';
import { ScannerView } from '@/components/scanners/ScannerView';
import { SCANNER_BY_SLUG, type ScannerSlug } from '@/lib/types';

export default function ScannerPage() {
  const params = useParams<{ slug: string }>();
  const meta = SCANNER_BY_SLUG[params.slug as ScannerSlug];

  if (!meta) {
    return (
      <AppShell>
        <main className="flex-1 p-6">
          <div className="card p-6 text-center">
            <h1 className="text-[15px] font-bold text-white">Unknown scanner</h1>
            <p className="mt-1 text-[11.5px] text-text-secondary">
              “{params.slug}” is not one of the five ScalpPro scanners.
            </p>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="min-w-0 flex-1 p-3">
        <ScannerView meta={meta} />
      </main>
    </AppShell>
  );
}
