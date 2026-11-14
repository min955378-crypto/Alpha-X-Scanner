import { NextResponse } from 'next/server';

import type { Entitlements } from '@/lib/types';
import { ALL_ENTITLEMENTS, getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MODULE 2  1-Click Customer + License Onboarding Studio.
 *
 * Creates the user, mints the key, binds it and starts the expiry clock in a
 * single atomic DB transaction (`db.onboardCustomer`), then returns everything
 * the UI needs to render the ready-to-deliver credentials card — including the
 * pre-filled WhatsApp deep link, so Muhammad Ibrahim can deliver in one tap.
 */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    whatsappNumber?: string | null;
    durationDays?: number;
    maxDevices?: number;
    grants?: Partial<typeof ALL_ENTITLEMENTS>;
  };

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: 'PASSWORD_TOO_SHORT' }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return NextResponse.json({ ok: false, error: 'BAD_USERNAME' }, { status: 400 });
  }

  const durationDays = Math.max(1, Math.min(3650, Math.round(body.durationDays ?? 30)));
  const maxDevices = Math.max(1, Math.min(99, Math.round(body.maxDevices ?? 25)));

  /* Every onboarding grants full access — the product no longer sells
     individual scanners (§2 of the v2.5 spec). */
  const grants: Entitlements = { ...ALL_ENTITLEMENTS, ...(body.grants ?? {}) };

  const db = getDb();
  const result = db.onboardCustomer({
    username,
    password,
    whatsappNumber: body.whatsappNumber ?? null,
    durationDays,
    maxDevices,
    grants,
  });

  if (!result.ok) {
    const status = result.error === 'USERNAME_TAKEN' ? 409 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  db.audit(admin.username, `ONBOARD_CUSTOMER ${username} (${durationDays}d, ${maxDevices} dev)`, result.user.id);

  return NextResponse.json({
    ok: true,
    credentials: {
      username: result.user.username,
      password,
      licenseKey: result.license.keyString,
      durationDays,
      maxDevices,
      expiresAt: result.license.expiresAt,
      whatsappNumber: result.user.whatsappNumber,
    },
  });
}
