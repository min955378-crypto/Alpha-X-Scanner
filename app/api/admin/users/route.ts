import { NextResponse } from 'next/server';

import { SCANNER_BY_SLUG, type EntitlementKey, type ScannerSlug } from '@/lib/types';
import { ALL_ENTITLEMENTS, getDb } from '@/server/engine/db';
import { pushAccessUpdate } from '@/server/ws';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MODULE 4  Users, password resetter & session matrix.
 *
 * Actions: create · toggle-entitlement · grant-full · suspend · reset-password
 *          · set-whatsapp · reset-devices · assign-key · mint-replacement-key
 *          · delete
 */
async function handlePost(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    action?:
      | 'create'
      | 'toggle-entitlement'
      | 'grant-full'
      | 'suspend'
      | 'reset-password'
      | 'set-whatsapp'
      | 'reset-devices'
      | 'assign-key'
      | 'mint-replacement-key'
      | 'delete';
    userId?: string;
    username?: string;
    password?: string;
    whatsappNumber?: string;
    entitlement?: EntitlementKey;
    value?: boolean;
    slug?: ScannerSlug;
    licenseId?: string;
    durationDays?: number;
    maxDevices?: number;
  };

  const db = getDb();

  /* ------------------------------- create -------------------------------- */
  if (body.action === 'create') {
    if (!body.username || !body.password) {
      return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 });
    }
    if (db.userByUsername(body.username)) {
      return NextResponse.json({ ok: false, error: 'USERNAME_TAKEN' }, { status: 409 });
    }
    const u = db.createUser({
      username: body.username,
      password: body.password,
      whatsappNumber: body.whatsappNumber ?? null,
    });
    db.audit(admin.username, 'USER_CREATE', u.id);
    return NextResponse.json({ ok: true, userId: u.id });
  }

  const target = body.userId ? db.userById(body.userId) : undefined;
  if (!target) return NextResponse.json({ ok: false, error: 'USER_NOT_FOUND' }, { status: 404 });

  switch (body.action) {
    case 'toggle-entitlement': {
      if (!body.entitlement) {
        return NextResponse.json({ ok: false, error: 'MISSING_ENTITLEMENT' }, { status: 400 });
      }
      db.setEntitlement(target, body.entitlement, Boolean(body.value));
      db.audit(admin.username, `ENTITLEMENT_${body.value ? 'GRANT' : 'REVOKE'}:${body.entitlement}`, target.id);
      pushAccessUpdate(target.id);
      break;
    }

    case 'grant-full': {
      for (const s of Object.values(SCANNER_BY_SLUG)) db.setEntitlement(target, s.entitlementKey, true);
      target.plan = 'ULTRA_PRO';
      db.persist();
      db.audit(admin.username, 'GRANT_FULL_ALPHA_X_PRO', target.id);
      pushAccessUpdate(target.id);
      break;
    }

    case 'suspend': {
      target.isSuspended = Boolean(body.value);
      db.persist();
      db.audit(admin.username, `USER_${target.isSuspended ? 'SUSPEND' : 'UNSUSPEND'}`, target.id);
      /* Suspending must drop the live socket, not just the next login. */
      pushAccessUpdate(target.id);
      break;
    }

    case 'reset-password': {
      if (!body.password) return NextResponse.json({ ok: false, error: 'MISSING_PASSWORD' }, { status: 400 });
      if (body.password.length < 6) return NextResponse.json({ ok: false, error: 'TOO_SHORT' }, { status: 400 });
      const { hashPassword } = await import('@/server/engine/db');
      target.passwordHash = hashPassword(body.password);
      db.persist();
      db.audit(admin.username, 'USER_RESET_PASSWORD', target.id);
      break;
    }

    case 'set-whatsapp': {
      target.whatsappNumber = body.whatsappNumber?.trim() || null;
      db.persist();
      db.audit(admin.username, 'USER_SET_WHATSAPP', target.id);
      break;
    }

    /** MODULE 4  Clear the device lock on whatever key this user holds. */
    case 'reset-devices': {
      const lic = db.licenseOf(target);
      if (!lic) return NextResponse.json({ ok: false, error: 'NO_LICENSE' }, { status: 404 });
      db.resetLicenseDevices(lic.id);
      db.audit(admin.username, 'USER_RESET_DEVICES', target.id);
      break;
    }

    /**
     * MODULE 3  Permanently remove a user.
     *
     * §3.1  `db.deleteUser` removes the row from memory, from disk and (through
     * the delete queue) from Supabase Postgres, so the next cold start cannot
     * bring them back. The last remaining admin is refused — deleting them
     * would make the portal permanently unreachable.
     */
    case 'delete': {
      const res = db.deleteUser(target.id);
      if (!res.ok) {
        const status =
          res.error === 'LAST_ADMIN' ? 409 : res.error === 'NOT_FOUND' ? 404 : 400;
        return NextResponse.json({ ok: false, error: res.error }, { status });
      }
      db.audit(admin.username, 'USER_DELETE', target.id);
      pushAccessUpdate(target.id);
      return NextResponse.json({ ok: true });
    }

    /** MODULE 4  Bind an existing unassigned key to this user. */
    case 'assign-key': {
      if (!body.licenseId) return NextResponse.json({ ok: false, error: 'MISSING_LICENSE' }, { status: 400 });
      const res = db.bindLicense(body.licenseId, target.id);
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      db.audit(admin.username, 'USER_ASSIGN_KEY', target.id);
      pushAccessUpdate(target.id);
      return NextResponse.json({ ok: true });
    }

    /** MODULE 4  Mint a brand-new key and swap it in, in one click. */
    case 'mint-replacement-key': {
      const durationDays = Math.max(1, Math.round(body.durationDays ?? 30));
      const maxDevices = Math.max(1, Math.min(99, Math.round(body.maxDevices ?? 25)));
      const lic = db.createLicense({
        plan: 'ULTRA_PRO',
        durationDays,
        grants: { ...ALL_ENTITLEMENTS },
        maxDevices,
      });
      const now = Date.now();
      lic.activatedAt = now;
      lic.expiresAt = now + durationDays * 86_400_000;

      const res = db.bindLicense(lic.id, target.id);
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

      db.audit(admin.username, `USER_MINT_KEY (${durationDays}d)`, target.id);
      pushAccessUpdate(target.id);
      return NextResponse.json({ ok: true, key: lic.keyString, expiresAt: lic.expiresAt });
    }

    default:
      return NextResponse.json({ ok: false, error: 'BAD_ACTION' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}
