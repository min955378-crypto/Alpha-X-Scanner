/**
 * §8  Serverless correctness regression suite.
 *
 * These are the failure modes that only appear on a serverless host: a cold
 * start serves (and then persists) default seed data because hydration had not
 * finished, and a single unmigrated column makes every write to a table fail
 * silently. Neither reproduces reliably by clicking around, so both are pinned
 * here against a controllable PostgREST mock.
 *
 * Run with `npm run qa:serverless`.
 */

/* First import: redirect the JSON snapshot before db.ts resolves its path. */
import './_isolate';

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface LogEntry {
  method: string;
  table: string;
  columns?: string[];
}

const PORT = 4623;

let store: Record<string, Record<string, unknown>[]> = {};
let log: LogEntry[] = [];
/** Columns the mock pretends do not exist yet (simulates an unrun migration). */
let missingColumns: string[] = [];
/** Force the next N upserts to fail outright regardless of payload. */
let hardFailUpserts = 0;

function startMock(): Promise<() => void> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const table = url.pathname.replace('/rest/v1/', '');

      if (req.method === 'GET') {
        log.push({ method: 'GET', table });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(store[table] ?? []));
        return;
      }

      if (req.method === 'DELETE') {
        log.push({ method: 'DELETE', table });
        res.writeHead(204).end();
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
          const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
          log.push({ method: 'POST', table, columns });

          if (hardFailUpserts > 0) {
            hardFailUpserts -= 1;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 'SERVER', message: 'boom' }));
            return;
          }

          const offender = missingColumns.find((c) => columns.includes(c));
          if (offender) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                code: 'PGRST204',
                details: null,
                hint: null,
                message: `Could not find the '${offender}' column of '${table}' in the schema cache`,
              }),
            );
            return;
          }

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

    server.listen(PORT, '127.0.0.1', () => resolve(() => server.close()));
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
  const stop = await startMock();

  process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.JWT_SECRET = 'test-jwt-secret';

  const { getDb } = await import('../server/engine/db');
  const { pgUpsert } = await import('../server/engine/pg');

  /* ------------------------------------------------------- §8.4 pgUpsert */
  console.log('\n§8.4  pgUpsert is schema-tolerant');
  {
    missingColumns = [];
    const ok = await pgUpsert('User', [{ id: 'u1', username: 'alice' }], 'id');
    check('a normal upsert succeeds', ok);
    check('the row landed', (store.User ?? []).some((r) => r.id === 'u1'));
  }

  {
    /* One unmigrated column must not stop the rest of the row persisting. */
    missingColumns = ['totpSecret'];
    log = [];
    const ok = await pgUpsert(
      'User',
      [{ id: 'u2', username: 'bob', totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: false }],
      'id',
    );
    check('an unmigrated column is stripped and the write succeeds', ok);
    const posts = log.filter((e) => e.method === 'POST');
    check('it retried', posts.length === 2, `${posts.length} POSTs`);
    check('the retry no longer carries the rejected column', !posts[1]?.columns?.includes('totpSecret'));
    check('the retry does carry the other new column', Boolean(posts[1]?.columns?.includes('totpEnabled')));
    const row = (store.User ?? []).find((r) => r.id === 'u2');
    check('the row persisted without the stripped column', row?.username === 'bob' && !('totpSecret' in (row ?? {})));
  }

  {
    /* Every column unmigrated: nothing left to strip, so it must give up
       rather than loop forever. */
    missingColumns = ['id', 'username'];
    log = [];
    const ok = await pgUpsert('User', [{ id: 'u3', username: 'carol' }], 'id');
    check('an all-rejected payload is abandoned', ok === false);
    check('it did not spin', log.filter((e) => e.method === 'POST').length <= 3, `${log.length} calls`);
  }

  {
    missingColumns = [];
    hardFailUpserts = 1;
    log = [];
    const ok = await pgUpsert('User', [{ id: 'u4', username: 'dave' }], 'id');
    check('a 500 is not retried as a schema problem', ok === false);
    check('only one attempt was made', log.filter((e) => e.method === 'POST').length === 1);
  }

  /* ------------------------------------------------------ §8.2 hydration */
  console.log('\n§8.2  ensureHydrated runs once per process');
  {
    missingColumns = [];
    hardFailUpserts = 0;

    /* Seed Postgres with a user that does NOT exist in the default seed, so we
       can prove hydration won rather than the seed. */
    store = {
      User: [
        {
          id: 'pg-only-1',
          username: 'from-postgres',
          email: null,
          passwordHash: 'scrypt$salt$hash',
          whatsappNumber: null,
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
          licenseKeyId: null,
          createdAt: 1,
          lastSeenAt: null,
          totpSecret: 'JBSWY3DPEHPK3PXP',
          totpEnabled: true,
          totpLastCounter: null,
        },
        {
          id: 'pg-victim',
          username: 'doomed-user',
          email: null,
          passwordHash: 'scrypt$salt$hash',
          whatsappNumber: null,
          role: 'USER',
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
          licenseKeyId: null,
          createdAt: 1,
          lastSeenAt: null,
        },
      ],
    };

    const db = getDb();
    log = [];

    const first = await db.ensureHydrated();
    check('hydration reports success', first === true);

    const getsAfterFirst = log.filter((e) => e.method === 'GET').length;
    check('it issued the table reads', getsAfterFirst >= 8, `${getsAfterFirst} GETs`);

    log = [];
    const second = await db.ensureHydrated();
    check('a second call resolves true', second === true);
    check(
      'a second call does NOT re-read Postgres',
      log.filter((e) => e.method === 'GET').length === 0,
      'cached promise',
    );

    /* This is the bug §8.2 exists to prevent: before hydration a cold process
       only knows its default seed users. */
    check('the Postgres-only admin was adopted', db.userById('pg-only-1') !== undefined);
    check(
      'and its 2FA state came with it',
      db.userById('pg-only-1')?.totpEnabled === true &&
        db.userById('pg-only-1')?.totpSecret === 'JBSWY3DPEHPK3PXP',
    );
    check('seed users are gone (Postgres is the source of truth)', db.userByUsername('admin') === undefined);
  }

  console.log('\n§8.2  Concurrent callers share one hydration');
  {
    const db2 = getDb();
    db2.resetHydration();
    log = [];
    await Promise.all([db2.ensureHydrated(), db2.ensureHydrated(), db2.ensureHydrated()]);
    const gets = log.filter((e) => e.method === 'GET').length;
    check('three concurrent calls produced one round of reads', gets <= 8, `${gets} GETs`);
  }

  /* --------------------------------------------- §8.4 deletes before upserts */
  console.log('\n§8.4  Deletions are replayed before the upserts');
  {
    const db = getDb();
    const victim = db.userById('pg-victim');
    check('the deletion test has a non-admin victim', victim !== undefined);
    if (victim) db.deleteUser(victim.id);
    log = [];
    await db.flushToPostgres();
    const methods = log.map((e) => e.method);
    const delIdx = methods.indexOf('DELETE');
    const postIdx = methods.indexOf('POST');
    check('a DELETE was issued', delIdx !== -1);
    check(
      'the DELETE was issued before the upserts',
      delIdx !== -1 && (postIdx === -1 || delIdx < postIdx),
      `order: ${methods.join(',')}`,
    );
  }

  /* ------------------------------------------- §1 zero-SQL 2FA persistence */
  console.log('\n§1   2FA survives an unmigrated User table (zero-SQL fallback)');
  {
    const { totpCode } = await import('../server/engine/totp');

    /* The exact production hazard: the `totp*` columns were never added by
       manual SQL, so PostgREST rejects them and `pgUpsert` strips them. */
    missingColumns = ['totpSecret', 'totpEnabled', 'totpLastCounter'];
    hardFailUpserts = 0;

    store = {
      User: [
        {
          id: 'unmigrated-admin',
          username: 'owner',
          email: null,
          passwordHash: 'scrypt$salt$hash',
          whatsappNumber: null,
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
          licenseKeyId: null,
          createdAt: 1,
          lastSeenAt: null,
        },
      ],
    };

    const db = getDb();
    db.resetHydration();
    await db.hydrateFromPostgres();

    const admin = db.userById('unmigrated-admin');
    check('the unmigrated admin hydrated', admin !== undefined);
    check('and arrived with no 2FA state', !admin?.totpSecret);

    /* Pair for real: mint a secret, then verify a live code to enable it. */
    const setup = db.totpSetup('unmigrated-admin');
    check('pairing produced a secret', typeof setup?.secret === 'string' && setup.secret.length > 0);
    const secret = setup?.secret ?? '';
    const enabled = db.verifyAndEnableTotp('unmigrated-admin', totpCode(secret));
    check('2FA was enabled with a valid code', enabled.ok === true);

    log = [];
    await db.flushToPostgres();

    const posts = log.filter((e) => e.method === 'POST' && e.table === 'User');
    const lastPost = posts[posts.length - 1];
    check('the upsert really did have to strip the totp columns', posts.length > 1, `${posts.length} POSTs`);
    check('the final payload carries no totpSecret column', !lastPost?.columns?.includes('totpSecret'));
    check('the final payload still carries savedPresetsJson', Boolean(lastPost?.columns?.includes('savedPresetsJson')));

    const written = (store.User ?? []).find((r) => r.id === 'unmigrated-admin') as
      | Record<string, unknown>
      | undefined;
    check('the persisted row has NO totpSecret column', !('totpSecret' in (written ?? {})));
    check(
      'but it does carry the backup inside savedPresetsJson',
      Boolean((written?.savedPresetsJson as Record<string, unknown> | null)?.__totpBackup),
    );

    /* Full cold start: throw away the in-memory record and rebuild from
       Postgres alone. Whatever survives here is what the admin gets. */
    db.resetHydration();
    const rehydrated = await db.hydrateFromPostgres();
    check('re-hydration succeeded', rehydrated === true);

    const restored = db.userById('unmigrated-admin');
    check('the secret survived the round trip', restored?.totpSecret === secret, restored?.totpSecret ?? 'MISSING');
    check('the enabled flag survived the round trip', restored?.totpEnabled === true);
    check(
      'the backup key is NOT exposed to the UI',
      !('__totpBackup' in ((restored?.savedPresetsJson as Record<string, unknown> | null) ?? {})),
    );
    check(
      'a code from the restored secret still verifies',
      db.checkTotp('unmigrated-admin', totpCode(secret)).ok === true,
    );

    /* A disabled account must stay disabled across the same round trip — the
       fallback re-enabling a second factor the owner switched off would be a
       lockout, not a rescue. */
    db.disableTotp('unmigrated-admin', totpCode(secret));
    await db.flushToPostgres();
    db.resetHydration();
    await db.hydrateFromPostgres();
    const afterDisable = db.userById('unmigrated-admin');
    check('disabling 2FA survives the round trip', afterDisable?.totpEnabled === false);
    check('and the secret is retained for re-pairing', afterDisable?.totpSecret === secret);

    /* `totpEnabled` is NOT NULL in Supabase. A row hydrated from a table that
       predates the column arrives with it `undefined`, which JSON.stringify
       silently drops — the write would then be rejected for a missing value. */
    check(
      'hydrated rows always carry a boolean totpEnabled',
      typeof afterDisable?.totpEnabled === 'boolean',
      String(afterDisable?.totpEnabled),
    );
    check(
      'and a nullable totpLastCounter (never undefined)',
      afterDisable?.totpLastCounter === null || typeof afterDisable?.totpLastCounter === 'number',
    );

    missingColumns = [];
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
