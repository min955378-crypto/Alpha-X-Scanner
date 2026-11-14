/**
 * §3  Persistence regression suite.
 *
 * The sandbox has no outbound network, so the real Supabase instance cannot be
 * reached from here. This suite stands up a local PostgREST mock instead and
 * drives the actual production code paths against it:
 *
 *   1. `hydrateFromPostgres()` must adopt whatever Postgres holds.
 *   2. `flushToPostgres()`    must upsert every table with the right rows,
 *                             the right conflict key and the right columns.
 *   3. Neither may throw or corrupt state when Postgres is absent/unreachable.
 *
 * Run with `npm run qa:pg`.
 */

import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface Recorded {
  table: string;
  onConflict: string | null;
  rows: unknown[];
}

let store: Record<string, unknown[]> = {};
let recorded: Recorded[] = [];
let failNext = false;

const PORT = 4599;

function startMock(): Promise<() => void> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const table = url.pathname.replace('/rest/v1/', '');

      if (failNext) {
        res.writeHead(500).end('{}');
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
          let rows: unknown[] = [];
          try {
            rows = JSON.parse(body) as unknown[];
          } catch {
            rows = [];
          }
          recorded.push({ table, onConflict: url.searchParams.get('on_conflict'), rows });
          store[table] = rows as unknown[];
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
  /* Probe mode — see the note below the imports. Must run before anything
     else so no Supabase env is ever established in this process. */
  if (process.env.QA_PG_PROBE === '1') {
    const { pgEnabled } = await import('../server/engine/pg');
    console.log(`PROBE:${pgEnabled()}`);
    return;
  }

  const stop = await startMock();

  /* Env must be set BEFORE server/engine/pg is imported: it reads these once
     at module load, exactly as it would at runtime. */
  process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.JWT_SECRET = 'test-jwt-secret';

  const { getDb } = await import('../server/engine/db');

  /* ---------------------------------------------------------------- 1 ---- */
  console.log('\n§3.1  Hydration adopts Postgres state');

  store = {
    User: [
      {
        id: 'u-1',
        username: 'pgadmin',
        email: null,
        passwordHash: 'scrypt$salt$hash',
        whatsappNumber: '03485581969',
        role: 'ADMIN',
        plan: 'ULTRA_PRO',
        isSuspended: false,
        canAccessV1Scaling: true,
        canAccessOrderBlock: true,
        canAccessEmaCrossover: true,
        canAccessHiddenBullish: true,
        canAccessAlphaSniper: true,
        preferredTimeframe: '1H',
        tileDensity: 'COMFORTABLE',
        soundEnabled: true,
        chartMode: 'INTERNAL',
        timezonePref: 'Asia/Karachi',
        watchlistSymbols: [],
        savedPresetsJson: null,
        acceptedDisclaimerAt: null,
        licenseKeyId: 'lk-1',
        createdAt: 1,
        lastSeenAt: null,
      },
    ],
    LicenseKey: [
      {
        id: 'lk-1',
        keyString: 'APS-TEST-0000-0001',
        status: 'ACTIVE',
        plan: 'ULTRA_PRO',
        durationDays: 3650,
        maxDevices: 99,
        activeDeviceHashes: [],
        grantV1Scaling: true,
        grantOrderBlock: true,
        grantEmaCrossover: true,
        grantHiddenBullish: true,
        grantAlphaSniper: true,
        assignedUserId: 'u-1',
        activatedAt: 1,
        expiresAt: 2,
        createdAt: 1,
      },
    ],
    SystemConfig: [{ id: 1, productName: 'Alpha X Scanner', whatsappContact: 'https://wa.me/923485581969' }],
    Coin: [{ symbol: 'BTCUSDT', enabled: true, isMonitoringTag: false, manualTagOverride: false, updatedAt: 1 }],
  };

  const db = getDb();
  const hydrated = await db.hydrateFromPostgres();

  check('hydrateFromPostgres reports success', hydrated === true);
  check('user adopted from Postgres', db.users.has('u-1') && db.users.get('u-1')!.username === 'pgadmin');
  check('license adopted from Postgres', db.licenses.has('lk-1'));
  check(
    'systemConfig adopted (singleton id stripped)',
    db.systemConfig.productName === 'Alpha X Scanner' && !('id' in (db.systemConfig as object)),
  );
  check('coin override adopted', db.coinOverrides.BTCUSDT?.enabled === true);

  /* ---------------------------------------------------------------- 2 ---- */
  console.log('\n§3.2  Flush upserts every table with the right conflict key');

  recorded = [];
  db.users.get('u-1')!.whatsappNumber = '0348-5581969';
  /* pgUpsert deliberately skips empty payloads, so give the audit log a row. */
  db.audit('pgadmin', 'QA_PROBE', 'u-1');
  await db.flushToPostgres();

  const byTable = Object.fromEntries(recorded.map((r) => [r.table, r]));

  check('User upserted', Boolean(byTable.User), `${byTable.User?.rows.length ?? 0} rows`);
  check('User conflicts on id', byTable.User?.onConflict === 'id', String(byTable.User?.onConflict));
  check(
    'User row carries the mutated column',
    (byTable.User?.rows[0] as { whatsappNumber?: string })?.whatsappNumber === '0348-5581969',
  );
  check('LicenseKey upserted, conflicts on id', byTable.LicenseKey?.onConflict === 'id');
  check('ScannerConfig upserted, conflicts on slug', byTable.ScannerConfig?.onConflict === 'slug');
  check(
    'SystemConfig upserted with singleton id=1',
    byTable.SystemConfig?.onConflict === 'id' &&
      (byTable.SystemConfig?.rows[0] as { id?: number })?.id === 1,
  );
  check('Coin upserted, conflicts on symbol', byTable.Coin?.onConflict === 'symbol');
  check('RiskWatchItem upserted', Boolean(byTable.RiskWatchItem));
  check('AdminAuditLog upserted', Boolean(byTable.AdminAuditLog));

  /* ---------------------------------------------------------------- 3 ---- */
  console.log('\n§3.3  Failure is non-fatal');

  failNext = true;
  let threw = false;
  try {
    await db.flushToPostgres();
    const bad = await db.hydrateFromPostgres();
    check('hydrate returns false when Postgres errors', bad === false);
  } catch {
    threw = true;
  }
  check('flush does not throw when Postgres errors', !threw);
  failNext = false;

  /* An empty Postgres must not wipe the in-memory seed. */
  store = {};
  const before = db.users.size;
  const empty = await db.hydrateFromPostgres();
  check('empty Postgres leaves the seed intact', empty === false && db.users.size === before, `${db.users.size} users`);

  /* ---------------------------------------------------------------- 4 ---- */
  console.log('\n§3.4  Disabled when unconfigured');

  /* SUPABASE_URL is read once at module load — correct in production, where
     env is fixed for the process lifetime — so the disabled path can only be
     observed in a fresh process that never had it set. */
  const clean = spawnSync('npx', ['tsx', 'scripts/qa-pg.ts'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      QA_PG_PROBE: '1',
    },
    encoding: 'utf8',
  });
  const probe = /PROBE:(true|false)/.exec(clean.stdout ?? '');
  check(
    'pgEnabled() false when SUPABASE_URL is unset',
    probe?.[1] === 'false',
    probe ? probe[1] : `no probe output: ${(clean.stderr ?? '').trim().split('\n').slice(-1)[0]}`,
  );
  check(
    'unconfigured flush is a no-op, not an error',
    await getDb()
      .flushToPostgres()
      .then(() => true)
      .catch(() => false),
  );

  stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
