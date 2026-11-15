/**
 * §1 + §3  New-customer onboarding end-to-end regression suite.
 *
 * The bug this exists to pin down: the admin creates a customer, the portal
 * says "created", and the customer immediately gets
 * "Username or password is incorrect."
 *
 * Reproducing it faithfully needs three things a click-through cannot give:
 *
 *   1. A **cold start** — the on-boarding request and the sign-in request must
 *      be served by a database whose in-memory state has been thrown away in
 *      between, exactly as happens when Vercel routes them to two different
 *      instances. That is `db.resetHydration() + db.hydrateFromPostgres()`.
 *   2. A **real HTTP round trip** through the actual route handlers, so the
 *      sanitising in `/api/auth/login` is exercised rather than assumed.
 *   3. **Hostile credentials** — the first letter capitalised, trailing
 *      whitespace, a zero-width joiner smuggled in by WhatsApp, and the whole
 *      password wrapped in the asterisks WhatsApp uses for bold.
 *
 * Postgres is a local PostgREST mock, because the sandbox has no outbound
 * network. The mock is deliberately an *independent* copy of the truth: the
 * only way a customer survives `resetHydration()` is by having actually been
 * written to it.
 *
 * Run with `npm run qa:onboarding`.
 */

/* Must be the first import — redirects the JSON snapshot before db.ts resolves
   its data file, so this suite never touches the real store. */
import './_isolate';

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = 4637;

/** The mock's tables. This is the *only* durable state in the suite. */
let store: Record<string, Record<string, unknown>[]> = {};

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

function startMock(): Promise<() => void> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const table = url.pathname.replace('/rest/v1/', '');

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(store[table] ?? []));
        return;
      }

      if (req.method === 'DELETE') {
        res.writeHead(204).end();
        return;
      }

      if (req.method === 'POST' || req.method === 'PATCH') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          let rows: Record<string, unknown>[] = [];
          try {
            rows = JSON.parse(body) as Record<string, unknown>[];
          } catch {
            rows = [];
          }
          const onConflict = url.searchParams.get('on_conflict') ?? 'id';
          if (process.env.AX_QA_TRACE) {
            for (const r of rows) {
              console.log(`      [mock] ${req.method} ${table} <- ${String(r[onConflict] ?? '')} (${String((r as {username?: unknown}).username ?? (r as {keyString?: unknown}).keyString ?? '')})`);
            }
          }
          const bucket = (store[table] ??= []);
          for (const row of rows) {
            const key = String(row[onConflict] ?? '');
            const at = bucket.findIndex((r) => String(r[onConflict] ?? '') === key);
            if (at >= 0) bucket[at] = { ...bucket[at], ...row };
            else bucket.push(row);
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end('');
        });
        return;
      }

      res.writeHead(405).end();
    });

    server.listen(PORT, '127.0.0.1', () => {
      resolve(() => {
        server.close();
      });
    });
  });
}

type Handler = (req: Request) => Promise<Response>;

/** Invokes a Next.js route handler the way the platform would. */
async function call(
  handler: Handler,
  path: string,
  init: { method: string; body?: unknown; cookie?: string },
): Promise<{ status: number; json: Record<string, unknown>; setCookie: string | null }> {
  const res = await handler(
    new Request(`http://qa.local${path}`, {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

async function main(): Promise<void> {
  const stop = await startMock();

  process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.SESSION_SECRET = 'test-session-secret';

  const { getDb } = await import('../server/engine/db');
  const { signSession } = await import('../server/engine/auth');

  const db = getDb();
  await db.hydrateFromPostgres();

  const { POST: onboardPost } = await import('../app/api/admin/onboarding/route');
  const { POST: loginPost } = await import('../app/api/auth/login/route');

  const admin = db.userByUsername('admin');
  if (!admin) {
    console.log('FAIL  seeded admin is missing — cannot run the suite');
    failed += 1;
    stop();
    return;
  }
  const adminCookie = `alpha_x_session=${signSession(db, admin.id)}`;

  /* ------------------------------------------------- §1.4 onboarding --- */
  console.log('\n§1.4  Onboarding reports a verified, Supabase-backed customer');

  const stamp = Date.now().toString(36);
  const username = `qaclient${stamp}`;
  const password = `Str0ng!pass${stamp}`;

  const onboard = await call(onboardPost, '/api/admin/onboarding', {
    method: 'POST',
    cookie: adminCookie,
    body: { username, password, whatsappNumber: '03001234567', durationDays: 30, maxDevices: 5 },
  });

  check('onboarding returns HTTP 200', onboard.status === 200, `HTTP ${onboard.status}`);
  check('onboarding reports ok', onboard.json.ok === true, String(onboard.json.error ?? ''));
  check(
    'the minted key matches the APS-XXXX-XXXX-XXXX format',
    /^APS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(
      String((onboard.json.credentials as { licenseKey?: string } | undefined)?.licenseKey ?? ''),
    ),
    String((onboard.json.credentials as { licenseKey?: string } | undefined)?.licenseKey ?? ''),
  );
  check(
    '§1.4  the response claims verifiedReady',
    onboard.json.verifiedReady === true,
    String(onboard.json.verifiedReady),
  );

  const creds = onboard.json.credentials as { username: string; password: string; licenseKey: string };
  check('the returned username matches what was requested', creds.username === username, creds.username);

  check(
    'the customer really reached Postgres (not just memory)',
    (store.User ?? []).some((r) => r.username === username),
    `${(store.User ?? []).length} user rows`,
  );
  check(
    'the license key really reached Postgres',
    (store.LicenseKey ?? []).some((r) => r.keyString === creds.licenseKey),
    `${(store.LicenseKey ?? []).length} key rows`,
  );

  /* ------------------------------------------------- §1.1 cold start --- */
  console.log('\n§1.1  A cold serverless instance can still sign the customer in');

  /* Throw away every in-memory row and re-read Postgres from scratch. This is
     precisely what happens when the sign-in lands on a different Vercel
     instance than the one that created the customer. */
  db.resetHydration();
  await db.hydrateFromPostgres();
  check(
    'the customer survived the cold start',
    db.userByUsername(username) !== undefined,
    `${db.users.size} users in memory`,
  );

  /* ------------------------------------------------- §1.3 sanitising --- */
  const hostile = (s: string) => `  ${s.slice(0, 1).toUpperCase()}${s.slice(1)}​  `;

  const cold = await call(loginPost, '/api/auth/login', {
    method: 'POST',
    body: {
      /* Mobile keyboards capitalise the first letter; WhatsApp adds padding,
         a zero-width joiner and bold asterisks. */
      username: hostile(username),
      password: `*${password}*`,
      licenseKey: `  ${creds.licenseKey.toLowerCase()}  `,
    },
  });

  check('§3  login returns HTTP 200', cold.status === 200, `HTTP ${cold.status}`);
  check('§3  login reports ok:true', cold.json.ok === true, String(cold.json.error ?? ''));
  check(
    'a session cookie is issued',
    Boolean(cold.setCookie?.includes('alpha_x_session=')) &&
      (cold.setCookie ?? '').includes('HttpOnly'),
    (cold.setCookie ?? 'none').split(';')[0]?.slice(0, 42) ?? '',
  );

  const sessionUser = cold.json.user as { username?: string; role?: string } | undefined;
  check('the session resolves to the new customer', sessionUser?.username === username, String(sessionUser?.username));
  check(
    'they are a customer, never an admin',
    sessionUser?.role !== 'ADMIN',
    String(sessionUser?.role),
  );

  /* The untouched credentials must keep working — sanitising must never
     become the only way in. */
  const plain = await call(loginPost, '/api/auth/login', {
    method: 'POST',
    body: { username, password, licenseKey: creds.licenseKey },
  });
  check('the untouched credentials still work', plain.status === 200 && plain.json.ok === true, `HTTP ${plain.status}`);

  /* A genuinely wrong password must still be refused — the sanitising must
     not have quietly turned into "accept anything". */
  const wrong = await call(loginPost, '/api/auth/login', {
    method: 'POST',
    body: { username, password: `${password}x`, licenseKey: creds.licenseKey },
  });
  check(
    'a wrong password is still rejected',
    wrong.status === 401 && wrong.json.ok === false,
    `HTTP ${wrong.status} ${String(wrong.json.error ?? '')}`,
  );

  /* A second cold start, then a second login: the key must be bound to this
     customer and must not have been consumed or re-minted. */
  db.resetHydration();
  await db.hydrateFromPostgres();
  const again = await call(loginPost, '/api/auth/login', {
    method: 'POST',
    body: { username: username.toUpperCase(), password, licenseKey: creds.licenseKey },
  });
  check(
    'an ALL-CAPS username also signs in (case-insensitive)',
    again.status === 200 && again.json.ok === true,
    `HTTP ${again.status} ${String(again.json.error ?? '')}`,
  );

  /* ------------------------------------------------ §1.2 zero loss ----- */
  console.log('\n§1.2  A rejected write is retried rather than dropped');
  {
    const before = db.users.size;
    db.resetHydration();
    await db.hydrateFromPostgres();
    check('re-hydration restores every user', db.users.size === before, `${before} -> ${db.users.size}`);

    const keys = [...db.licenses.values()].filter((l) => l.keyString === creds.licenseKey);
    check('exactly one row exists for the minted key', keys.length === 1, `${keys.length} rows`);
    check('the key is bound to the new customer', keys[0]?.assignedUserId === db.userByUsername(username)?.id);
    check('the key is not revoked', keys[0]?.status !== 'REVOKED', String(keys[0]?.status));
  }

  stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((err: unknown) => {
  console.error('\nQA run crashed:', err);
  process.exitCode = 1;
});
