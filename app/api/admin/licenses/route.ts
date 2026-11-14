import { NextResponse } from 'next/server';

import { ALL_ENTITLEMENTS, getDb } from '@/server/engine/db';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 3 — License key batch generator. */
export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    count?: number;
    durationDays?: number;
    plan?: 'LITE' | 'ULTRA_PRO';
    grants?: Partial<typeof ALL_ENTITLEMENTS>;
    action?: 'generate' | 'revoke' | 'bind';
    licenseId?: string;
    userId?: string;
  };

  const db = getDb();

  if (body.action === 'revoke') {
    const lic = body.licenseId ? db.licenses.get(body.licenseId) : undefined;
    if (!lic) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
    lic.status = 'REVOKED';
    db.persist();
    db.audit(admin.username, 'LICENSE_REVOKE', lic.id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'bind') {
    const lic = body.licenseId ? db.licenses.get(body.licenseId) : undefined;
    const user = body.userId ? db.userById(body.userId) : undefined;
    if (!lic || !user) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
    lic.assignedUserId = user.id;
    user.licenseKeyId = lic.id;
    user.canAccessV1Scaling = lic.grantV1Scaling;
    user.canAccessOrderBlock = lic.grantOrderBlock;
    user.canAccessEmaCrossover = lic.grantEmaCrossover;
    user.canAccessHiddenBullish = lic.grantHiddenBullish;
    user.canAccessAlphaSniper = lic.grantAlphaSniper;
    user.plan = lic.plan;
    db.persist();
    db.audit(admin.username, 'LICENSE_BIND', lic.id);
    return NextResponse.json({ ok: true });
  }

  const count = Math.min(50, Math.max(1, body.count ?? 5));
  const durationDays = body.durationDays ?? 30;
  const plan = body.plan ?? 'ULTRA_PRO';
  const grants = { ...(plan === 'ULTRA_PRO' ? ALL_ENTITLEMENTS : { canAccessV1Scaling: true }), ...(body.grants ?? {}) };

  const created = Array.from({ length: count }, () => {
    const l = db.createLicense({
      plan,
      durationDays,
      grants: grants as typeof ALL_ENTITLEMENTS,
    });
    return l.keyString;
  });

  db.audit(admin.username, `LICENSE_GENERATE x${count} (${plan}, ${durationDays}d)`);
  return NextResponse.json({ ok: true, keys: created });
}
