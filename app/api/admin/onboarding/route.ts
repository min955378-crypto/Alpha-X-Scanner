import { NextResponse } from 'next/server';

import type { Entitlements } from '@/lib/types';
import { verifyPassword } from '@/server/engine/db';
import { ALL_ENTITLEMENTS, getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MintedCredentials {
  username: string;
  password: string;
  licenseKey: string;
  durationDays: number;
  maxDevices: number;
  expiresAt: number | null;
  whatsappNumber: string | null;
}

/**
 * MODULE 2  1-Click Customer + License Onboarding Studio.
 *
 * Creates the user, mints the key, binds it and starts the expiry clock in a
 * single atomic DB transaction (`db.onboardCustomer`), then returns everything
 * the UI needs to render the ready-to-deliver credentials card — including the
 * pre-filled WhatsApp deep link, so Muhammad Ibrahim can deliver in one tap.
 */
async function handlePost(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin(req);
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

  const credentials: MintedCredentials = {
    username: result.user.username,
    password,
    licenseKey: result.license.keyString,
    durationDays,
    maxDevices,
    expiresAt: result.license.expiresAt,
    whatsappNumber: result.user.whatsappNumber,
  };

  /*
   * §1.4  Prove it before telling the admin it's done.
   *
   * The old flow reported success the instant the in-memory row existed, which
   * said "created" even when the Postgres write silently failed — and the
   * customer then hit "Username or password is incorrect." on a different
   * Vercel instance. So: flush, throw away the local cache, read Postgres
   * back, and run the exact checks a real sign-in will run. Only then is the
   * response allowed to claim `verifiedReady`.
   *
   * Deliberately not calling `login()` here — that would activate the key and
   * start the validity clock at onboarding time instead of at the customer's
   * first sign-in. These checks are read-only.
   */
  const verifiedReady = await verifyAgainstPostgres(credentials);

  return NextResponse.json({ ok: true, credentials, verifiedReady });
}

/**
 * §1.4  Read-only replay of the login gate against a freshly-hydrated DB.
 *
 * Returns true only when the username resolves case-insensitively, the
 * password hashes to the stored hash, and the minted key is present, unrevoked,
 * unexpired and bound to this customer.
 */
async function verifyAgainstPostgres(c: MintedCredentials): Promise<boolean> {
  try {
    const db = getDb();
    await db.flushToPostgres();
    await db.refreshFromPostgres();

    const user = db.userByUsername(c.username);
    if (!user) return false;
    if (!verifyPassword(c.password, user.passwordHash)) return false;
    if (user.isSuspended) return false;

    const key = db.licenseByKey(c.licenseKey);
    if (!key) return false;
    if (key.status === 'REVOKED') return false;
    if (key.expiresAt !== null && key.expiresAt < Date.now()) return false;
    if (key.assignedUserId !== null && key.assignedUserId !== user.id) return false;

    return true;
  } catch {
    /* A verification failure is a warning, never a reason to fail the
       onboarding — the customer does exist in memory and may well persist. */
    return false;
  }
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}
