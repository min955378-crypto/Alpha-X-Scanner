import { NextResponse } from 'next/server';

import { requireAdmin, isGuardError } from '../_guard';
import { flushAfter } from '../_flush';
import { cookieHeader, signSession, toSessionUser } from '@/server/engine/auth';
import { getDb, hashPassword, verifyPassword } from '@/server/engine/db';

/**
 * §2  Dedicated admin authentication — Username + Password + Authenticator
 * (TOTP). No License Key: the admin is the person who *mints* license keys, so
 * demanding one to reach `/admin` is circular.
 *
 * Actions
 *   login             no session required
 *   setup             returns (creating if needed) the pairing QR material
 *   enable            verify a code and switch the requirement on
 *   disable           verify a code and switch the requirement off
 *   rotate            mint a new secret (always disables — see db.rotateTotpSecret)
 *   verify            check a code without changing anything
 *   change-password   current + new password
 *   change-username   new username, confirmed with the password
 *
 * Every action except `login` requires an existing ADMIN session, so a code can
 * only ever be tested or enrolled by someone already authenticated.
 *
 * The cookie written here is the same `alpha_x_session` the customer login
 * uses, so signing in on `/admin` seamlessly replaces any customer session
 * rather than running alongside it.
 */

function field(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v : '';
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });

  /* §8.2  Every path here reads or writes admin state, so hydration must
     finish first — including `login`, which is why this sits above it. */
  /* §1.1  Same reasoning as `/api/auth/login`: another instance may have
     changed the admin credentials since this process booted, and a cached
     hydration promise would hide it. */
  await getDb().refreshFromPostgres();

  const action = String(body.action ?? '');

  /* §8.3  `login` mints a TOTP secret on first use; flush it before the
     function freezes. */
  if (action === 'login') return flushAfter(login(body));

  const guard = await requireAdmin(req);
  if (isGuardError(guard)) return guard.response;
  const { admin } = guard;
  const db = getDb();

  switch (action) {
    /* §8.3  `setup` generates the secret on first call, so it is a mutation
       and must be flushed like one. */
    case 'setup':
      return flushAfter(
        Promise.resolve().then(() => {
          const setup = db.totpSetup(admin.id);
          if (!setup) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
          return NextResponse.json({ ok: true, ...setup });
        }),
      );

    case 'enable': {
      const code = field(body, 'code').trim();
      if (!code) return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
      return flushAfter(
        Promise.resolve().then(() => {
          const res = db.verifyAndEnableTotp(admin.id, code);
          if (!res.ok) {
            return NextResponse.json(
              { ok: false, error: res.error ?? 'BAD_CODE' },
              { status: res.error === 'NO_SECRET' ? 409 : 401 },
            );
          }
          db.audit(admin.username, 'ADMIN_TOTP_ENABLED', admin.id);
          return NextResponse.json({ ok: true, totpEnabled: true });
        }),
      );
    }

    case 'disable': {
      const code = field(body, 'code').trim();
      return flushAfter(
        Promise.resolve().then(() => {
          const res = db.disableTotp(admin.id, code || undefined);
          if (!res.ok) {
            return NextResponse.json(
              { ok: false, error: res.error ?? 'BAD_CODE' },
              { status: res.error === 'CODE_REQUIRED' ? 400 : 401 },
            );
          }
          db.audit(admin.username, 'ADMIN_TOTP_DISABLED', admin.id);
          return NextResponse.json({ ok: true, totpEnabled: false });
        }),
      );
    }

    case 'rotate': {
      return flushAfter(
        Promise.resolve().then(() => {
          const setup = db.rotateTotpSecret(admin.id);
          if (!setup) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
          db.audit(admin.username, 'ADMIN_TOTP_ROTATED', admin.id);
          return NextResponse.json({ ok: true, ...setup });
        }),
      );
    }

    case 'verify': {
      const code = field(body, 'code').trim();
      if (!code) return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
      const res = db.checkTotp(admin.id, code);
      return NextResponse.json(
        res.ok ? { ok: true } : { ok: false, error: res.error ?? 'BAD_CODE' },
        { status: res.ok ? 200 : 401 },
      );
    }

    case 'change-password': {
      const current = field(body, 'currentPassword');
      const next = field(body, 'newPassword');
      if (!current || !next) {
        return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 });
      }
      if (next.length < 6) {
        return NextResponse.json({ ok: false, error: 'TOO_SHORT' }, { status: 400 });
      }
      return flushAfter(
        Promise.resolve().then(() => {
          const me = db.userById(admin.id);
          if (!me) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
          if (!verifyPassword(current, me.passwordHash)) {
            return NextResponse.json({ ok: false, error: 'BAD_CREDENTIALS' }, { status: 401 });
          }
          me.passwordHash = hashPassword(next);
          db.persist();
          db.audit(admin.username, 'ADMIN_PASSWORD_CHANGED', admin.id);
          return NextResponse.json({ ok: true });
        }),
      );
    }

    case 'change-username': {
      const next = field(body, 'newUsername').trim();
      const password = field(body, 'password');
      if (!next || !password) {
        return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 });
      }
      if (next.length < 3) {
        return NextResponse.json({ ok: false, error: 'TOO_SHORT' }, { status: 400 });
      }
      return flushAfter(
        Promise.resolve().then(() => {
          const me = db.userById(admin.id);
          if (!me) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
          if (!verifyPassword(password, me.passwordHash)) {
            return NextResponse.json({ ok: false, error: 'BAD_CREDENTIALS' }, { status: 401 });
          }
          const clash = db.userByUsername(next);
          if (clash && clash.id !== me.id) {
            return NextResponse.json({ ok: false, error: 'USERNAME_TAKEN' }, { status: 409 });
          }
          const previous = me.username;
          me.username = next;
          db.persist();
          db.audit(admin.username, 'ADMIN_USERNAME_CHANGED', admin.id);
          return NextResponse.json({ ok: true, username: next, previous });
        }),
      );
    }

    default:
      return NextResponse.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 });
  }
}

/**
 * §2.3  Admin login.
 *
 * Three outcomes, in order:
 *   1. Wrong username/password, or not an ADMIN  -> rejected.
 *   2. 2FA already paired                        -> a valid code is mandatory.
 *   3. 2FA not paired                            -> a code is optional. Supplying
 *      a correct one pairs the phone and switches the requirement on; skipping
 *      it still signs the admin in and returns the pairing material. That is the
 *      zero-lockout guarantee — the QR code can never lock anyone out, because
 *      seeing it is not what turns the requirement on.
 */
async function login(body: Record<string, unknown>): Promise<NextResponse> {
  const username = field(body, 'username').trim();
  const password = field(body, 'password');
  const code = field(body, 'code').trim();

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 });
  }

  const db = getDb();
  const user = db.userByUsername(username);

  /* Deliberately identical for "no such user" and "wrong password" so the
     endpoint cannot be used to enumerate admin account names. */
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ ok: false, error: 'BAD_CREDENTIALS' }, { status: 401 });
  }
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'NOT_ADMIN' }, { status: 403 });
  }
  if (user.isSuspended) {
    return NextResponse.json({ ok: false, error: 'SUSPENDED' }, { status: 403 });
  }

  const wasEnabled = user.totpEnabled === true;

  if (wasEnabled && !code) {
    return NextResponse.json({ ok: false, error: 'TOTP_REQUIRED' }, { status: 401 });
  }

  if (code) {
    /* Paired -> authenticate the code with replay protection.
       Unpaired -> the first correct code pairs the phone and switches the
       requirement on, which is why this branch exists at all. */
    const res = wasEnabled
      ? db.verifyTotpForLogin(user.id, code)
      : db.verifyAndEnableTotp(user.id, code);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.error ?? 'BAD_CODE' },
        { status: res.error === 'NO_SECRET' ? 409 : 401 },
      );
    }
  }

  user.lastSeenAt = Date.now();
  db.persist();

  const nowEnabled = user.totpEnabled === true;
  const token = signSession(db, user.id);

  const res = NextResponse.json({
    ok: true,
    user: toSessionUser(db, user),
    totpEnabled: nowEnabled,
    /* True whenever the phone is not paired yet, so the client can open the
       pairing wizard. `setup` carries the QR material for it. */
    requiresSetup: !nowEnabled,
    setup: nowEnabled ? null : db.totpSetup(user.id),
    ...(code && !wasEnabled ? { justPaired: true } : {}),
  });
  res.headers.set('set-cookie', cookieHeader(token));
  return res;
}
