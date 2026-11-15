import { NextResponse } from 'next/server';

import { clearCookieHeader, cookieHeader, login, type LoginFailure } from '@/server/engine/auth';
import { getDb } from '@/server/engine/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES: Record<LoginFailure, string> = {
  MISSING_FIELDS: 'Username, Password and License Key are all required.',
  BAD_CREDENTIALS: 'Username or password is incorrect.',
  BAD_LICENSE: 'That License Key was not found or has been revoked.',
  LICENSE_IN_USE: 'That License Key is already bound to another account.',
  LICENSE_EXPIRED: 'That License Key has expired. Contact admin on WhatsApp to renew.',
  SUSPENDED: 'This account is suspended. Contact admin on WhatsApp.',
};

/**
 * §1.3  Normalise a credential pasted out of a chat app.
 *
 * WhatsApp is how these credentials are delivered, and pasting out of it
 * routinely carries decorations the customer never meant to type: surrounding
 * bold asterisks, and invisible zero-width joiners that survive a `.trim()`.
 * Both were landing in the password and hashing to something that would never
 * match, surfacing as "Username or password is incorrect."
 */
const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;

function sanitizeCredential(raw: string, { upper = false } = {}): string {
  let out = (raw ?? '').replace(INVISIBLE, '').trim();
  /* Only strip *matched* surrounding asterisks - an asterisk inside a
     password is legitimate and must survive. */
  if (out.startsWith('*') && out.endsWith('*') && out.length > 2) {
    out = out.slice(1, -1).replace(INVISIBLE, '').trim();
  }
  return upper ? out.toUpperCase() : out;
}

/** §4.2  POST /api/v1/auth/login — the 3-field license gate. */
export async function POST(req: Request) {
  /*
   * §1.1  Re-read Postgres on every sign-in.
   *
   * `ensureHydrated()` caches its promise for the life of the process, so a
   * second Vercel instance that booted before this customer was created would
   * never see them and would answer BAD_CREDENTIALS. Logins are rare enough
   * that a fresh read is cheap; correctness is not optional here.
   */
  await getDb().refreshFromPostgres();

  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    licenseKey?: string;
  };

  const result = login(
    sanitizeCredential(body.username ?? ''),
    sanitizeCredential(body.password ?? '', { upper: false }),
    sanitizeCredential(body.licenseKey ?? '', { upper: true }),
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: MESSAGES[result.reason ?? 'BAD_CREDENTIALS'] },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true, user: result.user });
  res.headers.set('set-cookie', cookieHeader(result.token!));
  return res;
}

/** DELETE clears the session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('set-cookie', clearCookieHeader());
  return res;
}
