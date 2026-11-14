import { NextResponse } from 'next/server';

import { clearCookieHeader, cookieHeader, login, type LoginFailure } from '@/server/engine/auth';

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

/** §4.2  POST /api/v1/auth/login — the 3-field license gate. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    licenseKey?: string;
  };

  const result = login(body.username ?? '', body.password ?? '', body.licenseKey ?? '');

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
