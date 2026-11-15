import { NextResponse } from 'next/server';

import { parseCookies, sessionUserFromToken, SESSION_COOKIE } from '@/server/engine/auth';
import { getDb, type UserRecord } from '@/server/engine/db';

/** §10  Every admin mutation must pass through this guard. */
export async function requireAdmin(
  req: Request,
): Promise<{ admin: UserRecord } | { response: NextResponse }> {
  /* §8.2  A cold serverless instance starts from the default seed. Without
     this, the guard can authenticate against (or persist) seed data instead of
     the real rows in Postgres. */
  await getDb().ensureHydrated();

  const user = sessionUserFromToken(parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]);
  if (!user) return { response: NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (user.role !== 'ADMIN') return { response: NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }) };
  const db = getDb();
  const admin = db.userById(user.id);
  if (!admin) return { response: NextResponse.json({ ok: false, error: 'UNAUTHENTICATED' }, { status: 401 }) };
  return { admin };
}

export function isGuardError<T extends { response?: NextResponse }>(
  r: T | { admin: UserRecord },
): r is T & { response: NextResponse } {
  return 'response' in r;
}
