import { NextResponse } from 'next/server';

import { parseCookies, sessionUserFromToken, SESSION_COOKIE } from '@/server/engine/auth';
import { getDb } from '@/server/engine/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §1.2  Record that the user accepted the EN + Urdu disclaimers. */
export async function POST(req: Request) {
  const user = sessionUserFromToken(parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const db = getDb();
  const record = db.userById(user.id);
  if (record) {
    record.acceptedDisclaimerAt = Date.now();
    db.persist();
  }
  return NextResponse.json({ ok: true, acceptedAt: record?.acceptedDisclaimerAt ?? Date.now() });
}
