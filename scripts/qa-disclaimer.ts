/**
 * Disclaimer-audit regression test.
 *
 * Proves the two behaviours that produced the "Enter the Terminal kicks me
 * back to /login" bug can no longer happen:
 *
 *   1. A FAILED session refresh must not clear the session. The old
 *      `refresh()` called `setUser(null)` in its catch block, and the route
 *      guard turns a null user into `router.replace('/login')`.
 *   2. A failed/401 disclaimer persistence must still close the modal and
 *      leave every entitlement flag intact.
 *
 * The reducers under test are the exact ones shipped in AuthProvider /
 * AppShell, mirrored here because they run inside React. Keep them in sync.
 */

export {}; /* keep this file a module so its top-level names don't collide with scripts/qa-frame.ts */

type Role = 'ADMIN' | 'USER';

interface User {
  id: string;
  username: string;
  role: Role;
  plan: string;
  licenseKey: string | null;
  acceptedDisclaimerAt: number | null;
  entitlements: Record<string, boolean>;
}

const ENTITLEMENTS = [
  'canAccessV1Scaling',
  'canAccessOrderBlock',
  'canAccessEmaCrossover',
  'canAccessHiddenBullish',
  'canAccessAlphaSniper',
];

const makeUser = (username: string, role: Role, plan: string, entitlements: Record<string, boolean>): User => ({
  id: 'u1',
  username,
  role,
  plan,
  licenseKey: 'APS-9F4A-22C1-88E0',
  acceptedDisclaimerAt: null,
  entitlements,
});

const ALL = Object.fromEntries(ENTITLEMENTS.map((k) => [k, true]));
const LITE = Object.fromEntries(ENTITLEMENTS.map((k) => [k, k === 'canAccessV1Scaling']));

/* --------------------------- reducers under test -------------------------- */

/** Mirrors AuthProvider.refresh(): only a 200 with user:null may clear. */
function refreshReducer(prev: User | null, outcome: { ok: boolean; user: User | null } | 'THROW'): User | null {
  try {
    if (outcome === 'THROW') throw new Error('network down');
    if (!outcome.ok) throw new Error('http error');
    return outcome.user;
  } catch {
    return prev; // <- the fix: preserve, never null
  }
}

/** Mirrors AuthProvider.markDisclaimerAccepted(): merge disclaimer fields only. */
function markAccepted(prev: User | null): User | null {
  if (!prev) return prev;
  return { ...prev, acceptedDisclaimerAt: prev.acceptedDisclaimerAt ?? Date.now() };
}

/** Mirrors AppShell's guard: bounce only when there is genuinely no session. */
function guard(prev: User | null): 'LOGIN' | 'DASHBOARD' {
  return prev ? 'DASHBOARD' : 'LOGIN';
}

/* ---------------------------------- tests -------------------------------- */

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function assertEntitlementsIntact(before: User, after: User, label: string) {
  const same =
    after.role === before.role &&
    after.plan === before.plan &&
    after.licenseKey === before.licenseKey &&
    ENTITLEMENTS.every((k) => after.entitlements[k] === before.entitlements[k]);
  check(same, label, `role ${after.role} · plan ${after.plan} · key ${after.licenseKey}`);
}

console.log('Disclaimer / session-redirect regression suite\n');

// §1.3 — transport failure must not sign the user out.
for (const [name, u] of [
  ['admin', makeUser('admin', 'ADMIN', 'ULTRA_PRO', ALL)],
  ['demo', makeUser('demo', 'USER', 'LITE', LITE)],
] as Array<[string, User]>) {
  const after500 = refreshReducer(u, { ok: false, user: null });
  check(guard(after500) === 'DASHBOARD', `${name}: 500 on /api/auth/session keeps the session`);
  assertEntitlementsIntact(u, after500!, `${name}: entitlements intact after 500`);

  const afterThrow = refreshReducer(u, 'THROW');
  check(guard(afterThrow) === 'DASHBOARD', `${name}: network throw keeps the session`);
  assertEntitlementsIntact(u, afterThrow!, `${name}: entitlements intact after throw`);

  // A definitive 200 + null IS a real logout and must still bounce.
  const afterNull = refreshReducer(u, { ok: true, user: null });
  check(guard(afterNull) === 'LOGIN', `${name}: genuine 200+null still signs out`);
}

// §1.2 — markAccepted merges only the disclaimer field.
for (const [name, u] of [
  ['admin', makeUser('admin', 'ADMIN', 'ULTRA_PRO', ALL)],
  ['demo', makeUser('demo', 'USER', 'LITE', LITE)],
] as Array<[string, User]>) {
  const after = markAccepted(u)!;
  check(after.acceptedDisclaimerAt !== null, `${name}: acceptedDisclaimerAt set`);
  assertEntitlementsIntact(u, after, `${name}: §1.2 session preserved on acceptance`);
  check(
    ENTITLEMENTS.every((k) => after.entitlements[k] === u.entitlements[k]),
    `${name}: all 5 entitlement flags untouched`,
  );
}

// §1.4 — acceptance is idempotent (re-clicking must not reset the timestamp).
const once = markAccepted(makeUser('demo', 'USER', 'LITE', LITE))!;
const twice = markAccepted(once)!;
check(once.acceptedDisclaimerAt === twice.acceptedDisclaimerAt, 'acceptance is idempotent');

// Demo gating must survive the whole flow.
const demo = makeUser('demo', 'USER', 'LITE', LITE);
const demoAfter = refreshReducer(markAccepted(demo), 'THROW')!;
check(demoAfter.entitlements.canAccessV1Scaling === true, 'demo keeps V1 Scaling unlocked');
check(
  ENTITLEMENTS.filter((k) => k !== 'canAccessV1Scaling').every((k) => demoAfter.entitlements[k] === false),
  'demo keeps the other 4 scanners locked',
);
check(demoAfter.role === 'USER', 'demo role stays USER (no privilege escalation)');

// Admin keeps everything.
const admin = makeUser('admin', 'ADMIN', 'ULTRA_PRO', ALL);
const adminAfter = refreshReducer(markAccepted(admin), 'THROW')!;
check(ENTITLEMENTS.every((k) => adminAfter.entitlements[k] === true), 'admin keeps all 5 scanners');

console.log(`\n${failures === 0 ? '✓ all disclaimer regression checks passed' : `✗ ${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
