/**
 * §1–§3  Admin portal regression suite.
 *
 * Covers the three things this change set introduces that are easy to break
 * silently and expensive to discover in production:
 *
 *   1. §1.2  The session secret must be identical in every process, or a
 *            serverless cold start signs the admin out and `/admin` bounces.
 *   2. §2.2/§2.3  The TOTP pairing flow must never be able to lock the owner
 *            out, and must actually start requiring a code once enabled.
 *   3. §3.1  Deleting a user or a key must reach Postgres, not just memory,
 *            or hydration resurrects them on the next cold start.
 *
 * Postgres is reached through the same local PostgREST mock `qa-pg` uses,
 * because the sandbox has no outbound network.
 *
 * Run with `npm run qa:admin-auth`.
 */

/* Must be the first import — redirects the JSON snapshot before db.ts resolves
   its data file, so this suite never touches the real store. */
import './_isolate';

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface Deleted {
  table: string;
  filter: string | null;
}

const PORT = 4611;

let store: Record<string, Record<string, unknown>[]> = {};
let deletes: Deleted[] = [];
let upserts: Array<{ table: string; rows: unknown[] }> = [];

function startMock(): Promise<() => void> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const table = url.pathname.replace('/rest/v1/', '');

      if (req.method === 'DELETE') {
        /* Record the filter so we can prove the delete targeted the right row
           by the right column. */
        const filter = [...url.searchParams.keys()].find((k) => k !== 'on_conflict') ?? null;
        const key = filter ?? '';
        deletes.push({ table, filter });
        if (filter) {
          const [column, rawValue] = [key, url.searchParams.get(key) ?? ''];
          const value = rawValue.replace(/^eq\./, '');
          store[table] = (store[table] ?? []).filter((row) => String(row[column]) !== value);
        }
        res.writeHead(204).end();
        return;
      }

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(store[table] ?? []));
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          let rows: Record<string, unknown>[] = [];
          try {
            rows = JSON.parse(body) as Record<string, unknown>[];
          } catch {
            rows = [];
          }
          upserts.push({ table, rows });
          /* Merge on id like a real upsert so we can assert on the result. */
          const existing = store[table] ?? [];
          const byId = new Map(existing.map((r) => [String(r.id ?? r.slug ?? r.symbol), r]));
          for (const r of rows) byId.set(String(r.id ?? r.slug ?? r.symbol), r);
          store[table] = [...byId.values()];
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end('');
        });
        return;
      }

      res.writeHead(204).end();
    });

    server.listen(PORT, '127.0.0.1', () => {
      resolve(() => {
        server.close();
      });
    });
  });
}

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

async function main(): Promise<void> {
  /* Probe: SESSION_SECRET must be derived with no env at all, so this child
     gets a scrubbed environment. */
  if (process.env.QA_SECRET_PROBE === '1') {
    const { SESSION_SECRET } = await import('../server/engine/db');
    console.log(`PROBE:${SESSION_SECRET}`);
    return;
  }

  const stop = await startMock();

  process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.JWT_SECRET = 'test-jwt-secret';

  const { getDb, verifyPassword, fullEntitlements } = await import('../server/engine/db');
  const { totpCode } = await import('../server/engine/totp');

  const db = getDb();
  const admin = db.userByUsername('admin');
  if (!admin) {
    console.log('FAIL  seed admin missing — cannot continue');
    process.exit(1);
  }

  /* ------------------------------------------------------------------ §1.2 */
  console.log('\n§1.2  Session secret is deterministic across processes');
  const { SESSION_SECRET } = await import('../server/engine/db');
  check('JWT_SECRET is honoured when it is set', SESSION_SECRET === 'test-jwt-secret');

  /* The point of §1.2 is that a cold start with NO env still agrees with every
     other cold start, so both sides of the comparison must be unconfigured
     children — comparing against this process would just re-test the env. */
  const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const coldProbe = (): string | undefined => {
    const r = spawnSync(tsx, ['scripts/qa-admin-auth.ts'], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', QA_SECRET_PROBE: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    });
    return /PROBE:([0-9a-f]{64})/.exec(r.stdout ?? '')?.[1];
  };

  const secretA = coldProbe();
  const secretB = coldProbe();
  check('a cold process derives a 64-hex secret', /^[0-9a-f]{64}$/.test(secretA ?? ''), `${secretA?.slice(0, 12) ?? 'none'}…`);
  check(
    'two cold processes agree on the same secret',
    Boolean(secretA) && secretA === secretB,
    'this is what keeps sessions alive across serverless instances',
  );

  /* ------------------------------------------------------------------ §2.2 */
  console.log('\n§2.2  Authenticator state lives on the user and survives a flush');
  const setup1 = db.totpSetup(admin.id);
  check('setup returns a 32-char base32 secret', /^[A-Z2-7]{32}$/.test(setup1?.secret ?? ''), setup1?.secret ?? 'null');
  check('setup returns an otpauth:// URI', (setup1?.uri ?? '').startsWith('otpauth://totp/'));
  check('2FA is off on a fresh account', setup1?.enabled === false);

  const setup2 = db.totpSetup(admin.id);
  check('the secret is stable across calls (re-scanning is safe)', setup2?.secret === setup1?.secret);

  /* ------------------------------------------------------------------ §2.3 */
  console.log('\n§2.3  Pairing flow can never lock the owner out');
  const goodCode = totpCode(setup1!.secret);
  check('a wrong code does not enable 2FA', db.verifyAndEnableTotp(admin.id, '000000').ok === false);
  check('2FA still off after a wrong code', db.userById(admin.id)?.totpEnabled === false);

  check('the correct code enables 2FA', db.verifyAndEnableTotp(admin.id, goodCode).ok === true);
  check('user now reports totpEnabled', db.userById(admin.id)?.totpEnabled === true);

  check('checkTotp accepts a live code', db.checkTotp(admin.id, totpCode(setup1!.secret)).ok === true);
  check('checkTotp rejects a stale code', db.checkTotp(admin.id, '123456').ok === false);

  const rotated = db.rotateTotpSecret(admin.id);
  check('rotating mints a new secret', rotated?.secret !== setup1?.secret);
  check('rotating switches the requirement off', db.userById(admin.id)?.totpEnabled === false);

  /* Replay protection is scoped to sign-in: the same code must never log the
     admin in twice, but it must still work for management actions taken during
     the same 30-second step. */
  const secret2 = rotated!.secret;
  const code2 = totpCode(secret2);
  check('first sign-in with a code succeeds', db.verifyTotpForLogin(admin.id, code2).ok === true);
  check('replaying that code for sign-in is refused', db.verifyTotpForLogin(admin.id, code2).ok === false);
  check('the same code still works for management', db.verifyAndEnableTotp(admin.id, code2).ok === true);

  /* Disabling requires proof of a current code. */
  check('disable refuses without a code', db.disableTotp(admin.id).ok === false);
  check('disable accepts a valid code', db.disableTotp(admin.id, totpCode(secret2)).ok === true);
  check('2FA is off again', db.userById(admin.id)?.totpEnabled === false);

  /* ------------------------------------------------------------------ §3.1 */
  console.log('\n§3.1  Deletions reach Postgres, not just memory');

  /* Seed the mock as though Postgres already mirrors the current state. */
  await db.flushToPostgres();
  deletes = [];
  upserts = [];

  const victim = db.userByUsername('demo');
  if (!victim) {
    console.log('FAIL  seed demo user missing — cannot test deletion');
    process.exit(1);
  }
  const victimId = victim.id;

  const boundKeyId = victim.licenseKeyId;
  const res = db.deleteUser(victimId);
  check('deleteUser reports success', res.ok === true);
  check('user is gone from memory', db.userById(victimId) === undefined);
  check(
    'their license key is released, not deleted',
    boundKeyId ? db.licenses.get(boundKeyId)?.assignedUserId === null : true,
  );

  await db.flushToPostgres();

  const userDelete = deletes.find((d) => d.table === 'User');
  check('a DELETE was issued against the User table', Boolean(userDelete), userDelete?.filter ?? 'none');
  check(
    'the delete targeted the right row by id',
    userDelete?.filter === 'id' && (userDelete ? true : false),
    userDelete?.filter ?? 'none',
  );

  /* The delete must actually remove the row from the mirrored store. */
  const mirroredUsers = (store.User ?? []) as Array<{ id: string }>;
  check(
    'the row is gone from the Postgres mirror',
    !mirroredUsers.some((u) => u.id === victimId),
    `${mirroredUsers.length} rows remain`,
  );

  /* And a subsequent hydration must not resurrect them. */
  await db.hydrateFromPostgres();
  check('hydration does not resurrect the deleted user', db.userById(victimId) === undefined);
  check('hydration keeps the admin', db.userByUsername('admin') !== undefined);

  /* -------------------------------------------------- §3.1 last-admin guard */
  console.log('\n§3.1  The last admin cannot be deleted');
  const onlyAdmin = db.userByUsername('admin');
  const guard = onlyAdmin ? db.deleteUser(onlyAdmin.id) : { ok: false, error: 'MISSING' };
  check('deleting the last admin is refused', guard.ok === false, 'error' in guard ? guard.error : '');
  check('the admin still exists', db.userByUsername('admin') !== undefined);

  /* ------------------------------------------------------ §3.1 license path */
  console.log('\n§3.1  Deleted license keys reach Postgres too');
  deletes = [];
  const spare = db.createLicense({
    plan: 'ULTRA_PRO',
    durationDays: 30,
    maxDevices: 2,
    grants: fullEntitlements(),
  });
  await db.flushToPostgres();
  deletes = [];

  const del = db.deleteLicense(spare.id);
  await db.flushToPostgres();
  check('deleteLicense reports success', del.ok === true);
  await db.flushToPostgres();
  check(
    'a DELETE was issued against LicenseKey',
    deletes.some((d) => d.table === 'LicenseKey'),
    deletes.map((d) => d.table).join(',') || 'none',
  );
  const mirroredLicenses = (store.LicenseKey ?? []) as Array<{ id: string }>;
  check(
    'the key is gone from the Postgres mirror',
    !mirroredLicenses.some((l) => l.id === spare.id),
    `${mirroredLicenses.length} keys remain`,
  );

  /* ----------------------------------------------------------- seed sanity */
  console.log('\nSanity  seeded admin credentials still verify');
  const seeded = db.userByUsername('admin');
  check('admin password verifies', seeded ? verifyPassword('AlphaX@2026', seeded.passwordHash) : false);
  check('admin role is ADMIN', seeded?.role === 'ADMIN');

  stop();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  /* Set the code and let Node exit on its own: `process.exit()` discards
     piped stdout that has not been flushed yet, which silently turned a
     complete run into an empty log. */
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
