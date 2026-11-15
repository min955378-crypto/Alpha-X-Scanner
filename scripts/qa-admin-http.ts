/**
 * §1–§3  Admin portal HTTP regression suite.
 *
 * Drives a *running* production server (`npm run build` && `npm start`) over
 * real HTTP, because the things that broke in production were request-level:
 * a route that redirected, a session that did not survive, a delete that never
 * reached the database.
 *
 *   npm run build && npm start        # in another shell
 *   npm run qa:admin-http
 *
 * Override the target with `AX_QA_BASE=http://host:port`.
 */

import { totpCode } from '@/server/engine/totp';

const BASE = process.env.AX_QA_BASE ?? 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Res {
  status: number;
  json: Record<string, unknown>;
  cookie: string | null;
}

async function post(path: string, body: unknown, cookie?: string): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function getJson(path: string, cookie?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function get(path: string, cookie?: string): Promise<{ status: number; body: string; location: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get('location'),
  };
}

function setupOf(json: Record<string, unknown>): { secret: string; uri: string } | null {
  return (json.setup as { secret: string; uri: string } | null | undefined) ?? null;
}

async function main(): Promise<void> {
  /* ------------------------------------------------------------- §1.1 --- */
  console.log('\n§1.1  /admin never redirects');
  {
    const res = await get('/admin');
    check('anonymous /admin returns 200', res.status === 200, `HTTP ${res.status}`);
    check('no redirect header is issued', res.location === null, res.location ?? '');
    check('page never redirects to /dashboard', !res.body.includes("'/dashboard'"));
    check('page never redirects to /login', !res.body.includes("'/login'"));
  }
  {
    const login = await post('/api/auth/login', {
      username: 'demo',
      password: 'demo1234',
      licenseKey: 'APS-TRIAL-AA17-K4M2',
    });
    check('customer login works', login.status === 200, `HTTP ${login.status}`);
    const res = await get('/admin', login.cookie ?? undefined);
    check('a customer hitting /admin still gets 200', res.status === 200, `HTTP ${res.status}`);
    check('they are not redirected away', res.location === null, res.location ?? '');
    check(
      'they see the admin gate, not the customer terminal',
      res.body.includes('Executive Admin Portal') || res.body.includes('Initializing Alpha X Admin'),
    );
  }

  /* ------------------------------------------------------------ §1.3 ---- */
  console.log('\n§1.3  Admin Portal button is admin-only');
  {
    const anon = await get('/dashboard');
    check('customers never see the Admin Portal button', !anon.body.includes('Admin Portal'));
  }

  /* ------------------------------------------------------------ §2.1 ---- */
  console.log('\n§2.1  Dedicated admin login needs no License Key');
  {
    const r = await post('/api/admin/auth', { action: 'login', username: 'admin', password: 'wrong' });
    check('wrong password is rejected', r.status === 401 && r.json.error === 'BAD_CREDENTIALS', String(r.json.error));
  }
  {
    const r = await post('/api/admin/auth', { action: 'login', username: 'demo', password: 'demo1234' });
    check('a non-admin account is rejected', r.status === 403 && r.json.error === 'NOT_ADMIN', String(r.json.error));
  }
  {
    const r = await post('/api/admin/auth', { action: 'login', username: 'admin' });
    check('missing password is rejected', r.status === 400, `HTTP ${r.status}`);
  }

  let adminCookie = '';
  let secret = '';
  {
    const r = await post('/api/admin/auth', { action: 'login', username: 'admin', password: 'AlphaX@2026' });
    check('admin signs in with NO license key', r.status === 200 && r.json.ok === true, `HTTP ${r.status}`);
    check('a session cookie is issued', Boolean(r.cookie?.includes('alpha_x_session')));
    check('flagged as needing 2FA setup', r.json.requiresSetup === true);
    const setup = setupOf(r.json);
    secret = setup?.secret ?? '';
    check('pairing secret returned', /^[A-Z2-7]{32}$/.test(secret), secret.slice(0, 12) || 'none');
    check('pairing URI returned', (setup?.uri ?? '').startsWith('otpauth://totp/'));
    adminCookie = r.cookie ?? '';
  }

  /* ------------------------------------------------------------ §2.2 ---- */
  console.log('\n§2.2  The admin session is a real ADMIN session');
  {
    const r = await getJson('/api/admin/overview', adminCookie);
    check('authenticated admin reaches the portal API', r.status === 200, `HTTP ${r.status}`);
    check('overview reports the seeded users', Array.isArray(r.json.users), `${(r.json.users as unknown[])?.length ?? 0} users`);
  }

  /* ------------------------------------------------------------ §2.3 ---- */
  console.log('\n§2.3  Enabling 2FA, then enforcing it');
  {
    const bad = await post('/api/admin/auth', { action: 'enable', code: '000000' }, adminCookie);
    check('a wrong code does not enable 2FA', bad.status === 401 && bad.json.error === 'BAD_CODE', String(bad.json.error));
  }
  {
    const code = totpCode(secret);
    const r = await post('/api/admin/auth', { action: 'enable', code }, adminCookie);
    check('the real code enables 2FA', r.status === 200 && r.json.ok === true, `HTTP ${r.status}`);
  }
  {
    /* Fresh login must now demand a code. */
    const noCode = await post('/api/admin/auth', { action: 'login', username: 'admin', password: 'AlphaX@2026' });
    check(
      'login without a code is refused once paired',
      noCode.status === 401 && noCode.json.error === 'TOTP_REQUIRED',
      String(noCode.json.error),
    );

    const wrong = await post('/api/admin/auth', {
      action: 'login',
      username: 'admin',
      password: 'AlphaX@2026',
      code: '000000',
    });
    check('login with a wrong code is refused', wrong.status === 401 && wrong.json.error === 'BAD_CODE', String(wrong.json.error));

    const good = await post('/api/admin/auth', {
      action: 'login',
      username: 'admin',
      password: 'AlphaX@2026',
      code: totpCode(secret),
    });
    check('login with a valid code succeeds', good.status === 200 && good.json.ok === true, `HTTP ${good.status}`);
    check('it is no longer flagged for setup', good.json.requiresSetup === false);
    adminCookie = good.cookie ?? adminCookie;
  }

  /* ------------------------------------------------------------ §2.3 ---- */
  console.log('\n§2.3  Management actions require an admin session');
  {
    const anon = await post('/api/admin/auth', { action: 'setup' });
    check('setup without a session is refused', anon.status === 401, `HTTP ${anon.status}`);
    const r = await post('/api/admin/auth', { action: 'setup' }, adminCookie);
    check('setup returns the current secret', r.status === 200 && r.json.secret === secret);
    check('setup reports 2FA enabled', r.json.enabled === true);
  }
  {
    const r = await post('/api/admin/auth', { action: 'verify', code: totpCode(secret) }, adminCookie);
    check('a live code verifies', r.status === 200 && r.json.ok === true, `HTTP ${r.status}`);
  }

  /* ------------------------------------------------------------ §1 ---- */
  /*
   * The end-to-end shape of the reported bug: the admin creates a customer,
   * the customer tries to sign in, and gets "Username or password is
   * incorrect."
   *
   * `/api/auth/login` now re-reads Postgres on every request (§1.1) and
   * sanitises all three fields (§1.3), so the sign-in below is served by a
   * genuinely fresh read even though the same process handled the onboarding.
   * The in-process cold-start variant — `db.resetHydration()` between the two
   * requests — lives in `qa:onboarding`, which can reach the Database object.
   */
  console.log('\n§1  A brand-new customer can sign in immediately');
  {
    const username = `qa-new-${Date.now().toString(36)}`;
    const password = `Str0ng!${Date.now().toString(36)}`;

    const made = await post(
      '/api/admin/onboarding',
      { username, password, whatsappNumber: null, durationDays: 30, maxDevices: 5 },
      adminCookie,
    );
    check('onboarding returns HTTP 200', made.status === 200, `HTTP ${made.status}`);
    const creds = made.json.credentials as { licenseKey?: string } | undefined;
    check(
      'a bound APS-XXXX-XXXX-XXXX key is minted',
      /^APS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(creds?.licenseKey ?? ''),
      creds?.licenseKey ?? '',
    );
    check('§1.4  the API reports verifiedReady', made.json.verifiedReady === true, String(made.json.verifiedReady));

    /* Hostile input, exactly as it arrives from a phone: first letter
       capitalised by the keyboard, padding and a zero-width joiner pasted out
       of WhatsApp, and the password wrapped in bold asterisks. */
    const hostile = (v: string) => `  ${v.slice(0, 1).toUpperCase()}${v.slice(1)}\u200B  `;
    const login = await post('/api/auth/login', {
      username: hostile(username),
      password: `*${password}*`,
      licenseKey: `  ${(creds?.licenseKey ?? '').toLowerCase()}  `,
    });
    check('§1  the new customer signs in (HTTP 200)', login.status === 200, `HTTP ${login.status}`);
    check('§1  the response is ok:true', login.json.ok === true, String(login.json.error ?? ''));
    const who = login.json.user as { username?: string } | undefined;
    check('the session belongs to the new customer', who?.username === username, String(who?.username));

    /* The pristine credentials must keep working too. */
    const plain = await post('/api/auth/login', {
      username,
      password,
      licenseKey: creds?.licenseKey ?? '',
    });
    check('the untouched credentials also work', plain.status === 200 && plain.json.ok === true, `HTTP ${plain.status}`);

    /* Sanitising must not have become "accept anything". */
    const wrong = await post('/api/auth/login', {
      username,
      password: `${password}x`,
      licenseKey: creds?.licenseKey ?? '',
    });
    check('a wrong password is still refused', wrong.status === 401, `HTTP ${wrong.status}`);

    /* Leave the store as we found it. */
    const ov = await getJson('/api/admin/overview', adminCookie);
    const row = ((ov.json.users as Array<{ id: string; username: string }> | undefined) ?? []).find(
      (u) => u.username === username,
    );
    if (row) await post('/api/admin/users', { action: 'delete', userId: row.id }, adminCookie);
  }

  /* ------------------------------------------------------------ §3.1 ---- */
  console.log('\n§3.1  Deleting a user through the API');
  {
    const created = await post(
      '/api/admin/users',
      { action: 'create', username: `qa-victim-${Date.now()}`, password: 'victim1234' },
      adminCookie,
    );
    check('test customer created', created.status === 200 && created.json.ok === true, `HTTP ${created.status}`);
    const victimId = String(created.json.userId ?? '');

    const del = await post('/api/admin/users', { action: 'delete', userId: victimId }, adminCookie);
    check('delete reports success', del.status === 200 && del.json.ok === true, `HTTP ${del.status}`);

    const after = await getJson('/api/admin/overview', adminCookie);
    const users = (after.json.users as Array<{ id: string }> | undefined) ?? [];
    check('the deleted user is gone from the API', !users.some((u) => u.id === victimId), `${users.length} users`);

    const again = await post('/api/admin/users', { action: 'delete', userId: victimId }, adminCookie);
    check('deleting a missing user is a clean 404', again.status === 404, `HTTP ${again.status}`);
  }
  {
    const me = await getJson('/api/admin/overview', adminCookie);
    const admins = ((me.json.users as Array<{ id: string; role: string }> | undefined) ?? []).filter(
      (u) => u.role === 'ADMIN',
    );
    const del = await post('/api/admin/users', { action: 'delete', userId: admins[0]?.id }, adminCookie);
    check(
      'the last admin cannot be deleted',
      del.status === 409 && del.json.error === 'LAST_ADMIN',
      `HTTP ${del.status} ${String(del.json.error)}`,
    );
  }

  /* ----------------------------------------------------------- teardown - */
  console.log('\nRestore  2FA back off so the seeded state is unchanged');
  {
    const r = await post('/api/admin/auth', { action: 'disable', code: totpCode(secret) }, adminCookie);
    check('2FA disabled with a valid code', r.status === 200 && r.json.ok === true, `HTTP ${r.status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((err: unknown) => {
  console.error('\nQA run crashed:', err);
  process.exitCode = 1;
});
