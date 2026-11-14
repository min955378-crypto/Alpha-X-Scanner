import { NextResponse } from 'next/server';

import { getEngine } from '@/server/engine';
import { activeProviderId } from '@/server/engine/binance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Boot + data-plane status. Used by the splash screen and the admin portal. */
export async function GET() {
  const engine = getEngine();
  await engine.start();
  return NextResponse.json({
    ok: true,
    boot: engine.boot,
    dataMode: engine.dataMode,
    provider: activeProviderId(),
    cycle: engine.cycle,
    nextUpdateSec: engine.secondsToNextCycle(),
    coins: engine.store.symbols.size,
    signals: Object.fromEntries([...engine.signals].map(([k, v]) => [k, v.length])),
  });
}
