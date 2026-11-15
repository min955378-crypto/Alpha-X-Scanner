import { NextResponse } from 'next/server';

import type { Entitlements } from '@/lib/types';
import { ALL_ENTITLEMENTS, getDb } from '@/server/engine/db';
import { pushAccessUpdate } from '@/server/ws';
import { isGuardError, requireAdmin } from '../_guard';
import { flushAfter } from '../_flush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MODULE 3  License Key Vault — batch minting plus the full per-row action set
 * (reset devices, extend, max-devices, revoke/activate, delete, bind).
 *
 * Every action is atomic and audited. `pushAccessUpdate` is fired whenever a
 * user's entitlements could have changed so live sockets pick it up instantly
 * rather than at the next 60s cycle.
 */
async function handlePost(req: Request) {
  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;

  const body = (await req.json().catch(() => ({}))) as {
    action?:
      | 'generate'
      | 'reset-devices'
      | 'extend'
      | 'set-max-devices'
      | 'set-status'
      | 'delete'
      | 'bind';
    licenseId?: string;
    userId?: string;
    count?: number;
    durationDays?: number;
    maxDevices?: number;
    days?: number;
    status?: 'ACTIVE' | 'REVOKED';
    plan?: 'LITE' | 'ULTRA_PRO';
    grants?: Partial<typeof ALL_ENTITLEMENTS>;
  };

  const db = getDb();

  /* ----------------------------- batch mint ----------------------------- */
  if (!body.action || body.action === 'generate') {
    const count = Math.min(50, Math.max(1, Math.round(body.count ?? 5)));
    const durationDays = Math.max(1, Math.round(body.durationDays ?? 30));
    const plan = body.plan ?? 'ULTRA_PRO';
    const maxDevices = Math.max(1, Math.min(99, Math.round(body.maxDevices ?? 25)));
    const grants = {
      ...(plan === 'ULTRA_PRO' ? ALL_ENTITLEMENTS : { canAccessV1Scaling: true }),
      ...(body.grants ?? {}),
    } as Entitlements;

    const created = Array.from({ length: count }, () =>
      db.createLicense({ plan, durationDays, grants, maxDevices }).keyString,
    );

    db.audit(admin.username, `LICENSE_GENERATE x${count} (${plan}, ${durationDays}d, ${maxDevices} dev)`);
    return NextResponse.json({ ok: true, keys: created });
  }

  /* --------------------- everything below needs a key -------------------- */
  const lic = body.licenseId ? db.licenses.get(body.licenseId) : undefined;
  if (!lic) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });

  switch (body.action) {
    case 'reset-devices': {
      db.resetLicenseDevices(lic.id);
      db.audit(admin.username, 'LICENSE_RESET_DEVICES', lic.id);
      return NextResponse.json({ ok: true, maxDevices: lic.maxDevices, devicesUsed: 0 });
    }

    case 'extend': {
      const days = Number(body.days ?? 0);
      if (!Number.isFinite(days) || days <= 0) {
        return NextResponse.json({ ok: false, error: 'BAD_DAYS' }, { status: 400 });
      }
      const updated = db.extendLicense(lic.id, days);
      if (!updated) return NextResponse.json({ ok: false, error: 'EXTEND_FAILED' }, { status: 400 });
      db.audit(admin.username, `LICENSE_EXTEND +${days}d`, lic.id);
      if (updated.assignedUserId) pushAccessUpdate(updated.assignedUserId);
      return NextResponse.json({ ok: true, expiresAt: updated.expiresAt, status: updated.status });
    }

    case 'set-max-devices': {
      const max = Number(body.maxDevices ?? 1);
      if (!Number.isFinite(max)) return NextResponse.json({ ok: false, error: 'BAD_MAX' }, { status: 400 });
      const updated = db.setLicenseMaxDevices(lic.id, max);
      if (!updated) return NextResponse.json({ ok: false, error: 'UPDATE_FAILED' }, { status: 400 });
      db.audit(admin.username, `LICENSE_MAX_DEVICES ${updated.maxDevices}`, lic.id);
      return NextResponse.json({ ok: true, maxDevices: updated.maxDevices });
    }

    case 'set-status': {
      const status = body.status === 'REVOKED' ? 'REVOKED' : 'ACTIVE';
      const updated = db.setLicenseStatus(lic.id, status);
      if (!updated) return NextResponse.json({ ok: false, error: 'UPDATE_FAILED' }, { status: 400 });
      db.audit(admin.username, `LICENSE_${status === 'REVOKED' ? 'REVOKE' : 'ACTIVATE'}`, lic.id);
      /* Revoking must kill live sessions immediately. */
      if (updated.assignedUserId) pushAccessUpdate(updated.assignedUserId);
      return NextResponse.json({ ok: true, status: updated.status });
    }

    case 'delete': {
      const res = db.deleteLicense(lic.id);
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 409 });
      db.audit(admin.username, 'LICENSE_DELETE', lic.id);
      return NextResponse.json({ ok: true });
    }

    case 'bind': {
      if (!body.userId) return NextResponse.json({ ok: false, error: 'MISSING_USER' }, { status: 400 });
      const res = db.bindLicense(lic.id, body.userId);
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 404 });
      db.audit(admin.username, 'LICENSE_BIND', lic.id);
      pushAccessUpdate(body.userId);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ ok: false, error: 'BAD_ACTION' }, { status: 400 });
  }
}


/* §3  Durability wrappers — see ../_flush.ts. */

export async function POST(req: Request) {
  return flushAfter(handlePost(req));
}
