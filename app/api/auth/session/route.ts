import { NextResponse } from 'next/server';

import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';
import { parseCookies, sessionUserFromToken, SESSION_COOKIE } from '@/server/engine/auth';
import { getDb } from '@/server/engine/db';
import { getEngine } from '@/server/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/auth/session — current user, entitlements and branding config. */
export async function GET(req: Request) {
  const user = sessionUserFromToken(parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]);
  const db = getDb();
  const engine = getEngine();
  void engine.start();

  return NextResponse.json({
    ok: true,
    user,
    systemConfig: db.systemConfig ?? DEFAULT_SYSTEM_CONFIG,
    dataMode: engine.dataMode,
    boot: engine.boot,
  });
}
