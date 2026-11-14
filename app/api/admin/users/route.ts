import { NextResponse } from 'next/server';

import { SCANNER_BY_SLUG, type EntitlementKey, type ScannerSlug } from '@/lib/types';
import { getDb } from '@/server/engine/db';
import { pushAccessUpdate } from '@/server/ws';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 2 — Users & scanner entitlements matrix. */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    action: 'create' | 'toggle-entitlement' | 'suspend' | 'reset-password' | 'set-whatsapp' | 'grant-full';
    userId?: string;
    username?: string;
    password?: string;
    whatsappNumber?: string;
    entitlement?: EntitlementKey;
    value?: boolean;
    slug?: ScannerSlug;
  };

  const db = getDb();

  if (body.action === 'create') {
    if (!body.username || !body.password) return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 });
    if (db.userByUsername(body.username)) {
      return NextResponse.json({ ok: false, error: 'USERNAME_TAKEN' }, { status: 409 });
    }
    const u = db.createUser({ username: body.username, password: body.password, whatsappNumber: body.whatsappNumber ?? null });
    db.audit(admin.username, 'USER_CREATE', u.id);
    return NextResponse.json({ ok: true, userId: u.id });
  }

  const target = body.userId ? db.userById(body.userId) : undefined;
  if (!target) return NextResponse.json({ ok: false, error: 'USER_NOT_FOUND' }, { status: 404 });

  switch (body.action) {
    case 'toggle-entitlement': {
      if (!body.entitlement) return NextResponse.json({ ok: false, error: 'MISSING_ENTITLEMENT' }, { status: 400 });
      db.setEntitlement(target, body.entitlement, Boolean(body.value));
      db.audit(admin.username, `ENTITLEMENT_${body.value ? 'GRANT' : 'REVOKE'}:${body.entitlement}`, target.id);
      pushAccessUpdate(target.id);
      break;
    }
    case 'grant-full': {
      for (const s of Object.values(SCANNER_BY_SLUG)) db.setEntitlement(target, s.entitlementKey, true);
      target.plan = 'ULTRA_PRO';
      db.persist();
      db.audit(admin.username, 'GRANT_FULL_ULTRA_PRO', target.id);
      pushAccessUpdate(target.id);
      break;
    }
    case 'suspend': {
      target.isSuspended = Boolean(body.value);
      db.persist();
      db.audit(admin.username, `USER_${target.isSuspended ? 'SUSPEND' : 'UNSUSPEND'}`, target.id);
      break;
    }
    case 'reset-password': {
      if (!body.password) return NextResponse.json({ ok: false, error: 'MISSING_PASSWORD' }, { status: 400 });
      const { hashPassword } = await import('@/server/engine/db');
      target.passwordHash = hashPassword(body.password);
      db.persist();
      db.audit(admin.username, 'USER_RESET_PASSWORD', target.id);
      break;
    }
    case 'set-whatsapp': {
      target.whatsappNumber = body.whatsappNumber ?? null;
      db.persist();
      db.audit(admin.username, 'USER_SET_WHATSAPP', target.id);
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: 'BAD_ACTION' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
