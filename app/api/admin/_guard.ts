import { NextResponse } from 'next/server';

import { parseCookies, sessionUserFromToken, SESSION_COOKIE } from '@/server/engine/auth';
import { getDb, type UserRecord } from '@/server/engine/db';

/** §10  Every admin mutation must pass through this guard. */
export async function requireAdmin(
  req: Request,
): Promise<{ admin: UserRecord } | { response: NextResponse }> {
  /*
   * §8.2  A cold serverless instance starts from the default seed. Without
   * this, the guard can authenticate against (or persist) seed data instead of
   * the real rows in Postgres.
   *
   * §1.1  A mutation additionally forces a fresh read. Vercel runs several
   * instances side by side, so instance B's cached hydration can predate a
   * change instance A just committed — and a mutation built on that stale
   * view would then write it back, clobbering the newer state. Reads keep the
   * cheap cached path; anything that writes starts from what Postgres actually
   * holds right now.
   */
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    await getDb().ensureHydrated();
  } else {
    await getDb().refreshFromPostgres();
  }

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
