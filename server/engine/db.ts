import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEFAULT_SYSTEM_CONFIG, MONITORING_TAG_SYMBOLS } from '@/lib/constants';
import {
  PG_TABLES,
  pgDeleteById,
  pgEnabled,
  pgSelect,
  pgUpsert,
  toSystemConfigRow,
} from './pg';
import { generateTotpSecret, totpUri, verifyTotp } from './totp';
import {
  SCANNERS,
  type AuditLogRow,
  type EntitlementKey,
  type Entitlements,
  type LicenseKeyRow,
  type PlanTier,
  type RiskWatchItem,
  type RiskCategory,
  type Role,
  type CustomSignal,
  type ScannerConfigRow,
  type ScannerSlug,
  type SystemConfig,
  type Timeframe,
} from '@/lib/types';

/**
 * §12.1  Repository layer.
 *
 * ARCHITECTURE NOTE — no Prisma/Postgres in this build.
 *
 * §13 of the spec specifies Prisma models. This deployment deliberately does
 * NOT use them: the host exposes a single port, so the HTTP server, the
 * WebSocket data plane, the market engine and this repository all live in one
 * Node process (see `server/index.ts`). Adding Postgres would mean a second
 * service that cannot be reached from the sandbox preview.
 *
 * Instead the §13 schema is expressed as TypeScript row types in `lib/types.ts`
 * and persisted here as a JSON snapshot under `.data/` (git-ignored). Every
 * `@@index` / `@@unique` from §13 is documented against its corresponding
 * `Map` below, and this class implements the same repository contract the
 * Prisma models would have, so swapping in a PrismaClient later is a
 * single-file change — call sites and row shapes stay identical.
 */

/**
 * `AX_DATA_DIR` lets a caller point the JSON snapshot somewhere other than the
 * server's working directory. The QA suites set it to a scratch path so that
 * exercising the database layer cannot clobber the store a running server (or
 * a developer) is using — before this existed, a QA run overwrote the real
 * `.data` snapshot with its fixtures and broke local logins.
 */
const DATA_DIR = process.env.AX_DATA_DIR ? join(process.env.AX_DATA_DIR) : join(process.cwd(), '.data');
const DB_FILE = join(DATA_DIR, 'alpha-x-scanner-db.json');

export interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string;
  whatsappNumber: string | null;
  role: Role;
  plan: PlanTier;
  isSuspended: boolean;
  canAccessV1Scaling: boolean;
  canAccessOrderBlock: boolean;
  canAccessEmaCrossover: boolean;
  canAccessHiddenBullish: boolean;
  canAccessAlphaSniper: boolean;
  preferredTimeframe: Timeframe;
  tileDensity: 'COMPACT' | 'COMFORTABLE';
  soundEnabled: boolean;
  chartMode: 'EXTERNAL_TV' | 'INTERNAL';
  timezonePref: string;
  watchlistSymbols: string[];
  savedPresetsJson: unknown | null;
  acceptedDisclaimerAt: number | null;
  licenseKeyId: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  /**
   * §2.2  Authenticator app (RFC 6238 TOTP) state for the admin.
   *
   * Optional so rows written before this feature existed keep type-checking;
   * `migrateTotpFields()` fills them in on load.
   *
   * `totpSecret` is the Base32 shared secret. It is shown to the admin once
   * during pairing and again from the security module — it is a credential,
   * but it is useless without the matching 6-digit code, and the admin needs
   * it to re-pair a new phone.
   */
  totpSecret?: string | null;
  /** Once true, `/admin` login requires a valid code. */
  totpEnabled?: boolean;
  /** Step of the last code this user spent, for replay protection. */
  totpLastCounter?: number | null;
}

export interface LicenseRecord {
  id: string;
  keyString: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  plan: PlanTier;
  durationDays: number;
  maxDevices: number;
  activeDeviceHashes: string[];
  grantV1Scaling: boolean;
  grantOrderBlock: boolean;
  grantEmaCrossover: boolean;
  grantHiddenBullish: boolean;
  grantAlphaSniper: boolean;
  assignedUserId: string | null;
  activatedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
}

/* --------------------------- backup snapshot ---------------------------- */

/** Bump only when the shape changes incompatibly. */
export const SNAPSHOT_VERSION = 1;

/** MODULE 9  Everything a restore needs. `secret` is deliberately excluded. */
export interface DbSnapshot {
  version: number;
  exportedAt: number;
  users: UserRecord[];
  licenses: LicenseRecord[];
  scannerConfigs: ScannerConfigRow[];
  systemConfig: SystemConfig;
  riskItems: RiskWatchItem[];
  customSignals: CustomSignal[];
  auditLogs: AuditLogRow[];
  coinOverrides: CoinOverrideRow[];
}

/**
 * MODULE 6  An admin's explicit enable / ⚠ Monitoring Tag choice for a coin.
 * Persisted because the engine store is in-memory only — without this an
 * override would vanish on restart and never appear in a backup.
 */
export interface CoinOverrideRow {
  symbol: string;
  enabled: boolean;
  isMonitoringTag: boolean;
  manualTagOverride: boolean;
  updatedAt: number;
}

interface DbShape {
  users: UserRecord[];
  licenses: LicenseRecord[];
  scannerConfigs: ScannerConfigRow[];
  systemConfig: SystemConfig;
  riskItems: RiskWatchItem[];
  customSignals: CustomSignal[];
  auditLogs: AuditLogRow[];
  coinOverrides: Record<string, CoinOverrideRow>;
  secret: string;
  /** §2.2  Set once the stored snapshot has been promoted to full access. */
  unlockedAllAt?: number | null;
}

/** §2.2  Column lists the unlock migration walks. */
const ENTITLEMENT_KEYS: EntitlementKey[] = [
  'canAccessV1Scaling',
  'canAccessOrderBlock',
  'canAccessEmaCrossover',
  'canAccessHiddenBullish',
  'canAccessAlphaSniper',
];

const GRANT_KEYS = [
  'grantV1Scaling',
  'grantOrderBlock',
  'grantEmaCrossover',
  'grantHiddenBullish',
  'grantAlphaSniper',
] as const;

/* --------------------------------- crypto --------------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateLicenseKey(): string {
  const block = () =>
    Array.from(randomBytes(4))
      .map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length])
      .join('');
  return `APS-${block()}-${block()}-${block()}`;
}

/* ------------------------------- seed data -------------------------------- */

const ALL_ENTITLEMENTS: Entitlements = {
  canAccessV1Scaling: true,
  canAccessOrderBlock: true,
  canAccessEmaCrossover: true,
  canAccessHiddenBullish: true,
  canAccessAlphaSniper: true,
};

/**
 * §2  EVERY active license key unlocks 100% of the platform.
 *
 * Access is gated purely by license status (ACTIVE vs EXPIRED/REVOKED) and
 * remaining duration — never by locking individual scanner tabs. LITE is kept
 * as a plan label only (it drives device slots), so it carries the same full
 * entitlement set as ULTRA_PRO.
 */
const LITE_ENTITLEMENTS: Entitlements = {
  canAccessV1Scaling: true,
  canAccessOrderBlock: true,
  canAccessEmaCrossover: true,
  canAccessHiddenBullish: true,
  canAccessAlphaSniper: true,
};

/** §2.2  Both seeded accounts get every scanner out of the box. */
export function fullEntitlements(): Entitlements {
  return { ...ALL_ENTITLEMENTS };
}

function defaultScannerConfigs(): ScannerConfigRow[] {
  return SCANNERS.map((s) => ({
    slug: s.slug,
    displayName: s.name,
    sidebarLabel: s.sidebarLabel,
    categoryLabel: s.category,
    subtitle: s.subtitle,
    enabled: true,
    defaultTimeframe: (s.tfLabel.includes('15M') ? '15M' : '1H') as Timeframe,
    scanIntervalSec: 60,
    parametersJson: defaultParams(s.slug),
    updatedAt: Date.now(),
  }));
}

export function defaultParams(slug: ScannerSlug): Record<string, number> {
  switch (slug) {
    case 'v1-scaling':
      return { rsiPotentialLo: 50, rsiPotentialHi: 52, rsiWaitingLo: 52, rsiWaitingHi: 55, rsiEntryLo: 52.5, rsiEntryHi: 58.5, rvolPotential: 1.25, rvolEntry: 1.5, slAtr: 1.2, tp1Atr: 1.8, tp2Atr: 3.0 };
    case 'order-block':
      return { atrWidthMin: 0.15, atrWidthMax: 1.6, maxTouches: 1, potentialDistPct: 2.0, waitingAtr: 0.15, wickRatio: 0.45, rvolEntry: 1.3, slAtr: 0.25, tp2Multiple: 2.5 };
    case 'ema-crossover':
      return { coilAtr: 0.2, pullbackAtr: 0.25, slAtrOffset: 0.3, tp1Atr: 1.5, tp2Atr: 2.8, rvolEntry: 1.25, extremeGuardPct: 1.0 };
    case 'hidden-bullish':
      return { rsiLo: 30, rsiHi: 40, rsiShortLo: 60, rsiShortHi: 70, minGap: 5, maxGap: 40, rsiTurn: 1.5, rvolEntry: 1.2, slAtr: 1.0, tp1Atr: 1.8, tp2Atr: 3.0 };
    case 'alpha-sniper':
      return { rsiLen: 14, smoothLen: 3, emaFast: 13, emaSlow: 34, lowerBand: 30, upperBand: 70, midBand: 50, minTrades: 5, minWinRate: 55, potentialLo: 33, potentialHi: 67, slAtr: 1.0, tp1Atr: 1.5, tp2Atr: 3.0 };
    default:
      return {};
  }
}

function seed(): DbShape {
  const now = Date.now();

  const ultraPro: LicenseRecord = {
    id: randomUUID(),
    keyString: 'APS-9F4A-22C1-88E0',
    status: 'ACTIVE',
    plan: 'ULTRA_PRO',
    durationDays: 3650,
    /* §1.2  The owner's key must never trip LICENSE_IN_USE. */
    maxDevices: 99,
    activeDeviceHashes: [],
    ...grantsFrom(ALL_ENTITLEMENTS),
    assignedUserId: null,
    activatedAt: null,
    expiresAt: null,
    createdAt: now,
  };

  const trial: LicenseRecord = {
    id: randomUUID(),
    keyString: 'APS-TRIAL-AA17-K4M2',
    status: 'ACTIVE',
    plan: 'LITE',
    /* §1.2  90d / 25 devices so testing demo across browsers and phones
       never triggers LICENSE_IN_USE. */
    durationDays: 90,
    maxDevices: 25,
    activeDeviceHashes: [],
    ...grantsFrom(LITE_ENTITLEMENTS),
    assignedUserId: null,
    activatedAt: null,
    expiresAt: null,
    createdAt: now,
  };

  const admin: UserRecord = {
    id: randomUUID(),
    username: 'admin',
    email: null,
    passwordHash: hashPassword('AlphaX@2026'),
    whatsappNumber: '0348-5581969',
    role: 'ADMIN',
    plan: 'ULTRA_PRO',
    isSuspended: false,
    ...ALL_ENTITLEMENTS,
    preferredTimeframe: '1H',
    tileDensity: 'COMFORTABLE',
    soundEnabled: false,
    chartMode: 'EXTERNAL_TV',
    timezonePref: 'Asia/Karachi',
    watchlistSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    savedPresetsJson: null,
    acceptedDisclaimerAt: now,
    licenseKeyId: ultraPro.id,
    createdAt: now,
    lastSeenAt: null,
  };

  const demo: UserRecord = {
    id: randomUUID(),
    username: 'demo',
    email: null,
    passwordHash: hashPassword('demo1234'),
    whatsappNumber: null,
    role: 'USER',
    plan: 'ULTRA_PRO',
    isSuspended: false,
    ...ALL_ENTITLEMENTS,
    preferredTimeframe: '1H',
    tileDensity: 'COMFORTABLE',
    soundEnabled: true,
    chartMode: 'EXTERNAL_TV',
    timezonePref: 'Asia/Karachi',
    watchlistSymbols: ['BTCUSDT', 'SOLUSDT', 'PEPEUSDT'],
    savedPresetsJson: null,
    acceptedDisclaimerAt: null,
    licenseKeyId: null,
    createdAt: now,
    lastSeenAt: null,
  };

  ultraPro.assignedUserId = admin.id;

  return {
    users: [admin, demo],
    licenses: [ultraPro, trial],
    scannerConfigs: defaultScannerConfigs(),
    systemConfig: { ...DEFAULT_SYSTEM_CONFIG },
    riskItems: [],
    customSignals: [],
    coinOverrides: {},
    auditLogs: [],
    secret: SESSION_SECRET,
  };
}

/**
 * §1.2  Session signing secret — stable across every serverless instance.
 *
 * The file-backed store persists a random secret on first boot, but a
 * serverless deployment has no writable disk: every cold start mints a new
 * secret, which invalidates every live session. On Vercel that meant an admin
 * who logged in could be signed out by the very next request landing on a
 * freshly-booted instance — which the `/admin` guard read as "not an admin"
 * and bounced to `/dashboard`. That is the third root cause of the redirect
 * bug.
 *
 * `JWT_SECRET` remains the preferred value. When it is absent we derive one
 * deterministically from a fixed passphrase instead of generating a random
 * string, so every cold start agrees on the same secret and sessions survive.
 *
 * The fallback is NOT a secret in any meaningful sense — it is compiled into
 * the source. Anyone deploying this must set `JWT_SECRET` in production; the
 * fallback exists only so a missing variable degrades to "sessions work"
 * rather than "nobody can stay logged in".
 */
export const SESSION_SECRET: string =
  process.env.JWT_SECRET ||
  createHash('sha256').update('alpha-x-scanner-muhammad-ibrahim-master-jwt-secret-2026').digest('hex');

function grantsFrom(e: Entitlements) {
  return {
    grantV1Scaling: e.canAccessV1Scaling,
    grantOrderBlock: e.canAccessOrderBlock,
    grantEmaCrossover: e.canAccessEmaCrossover,
    grantHiddenBullish: e.canAccessHiddenBullish,
    grantAlphaSniper: e.canAccessAlphaSniper,
  };
}

/**
 * §3.1  A row to remove from Postgres on the next flush.
 */
interface PendingDelete {
  table: string;
  column: string;
  value: string;
  /** Failed delivery attempts; the delete is abandoned once it hits the cap. */
  attempts: number;
}

/** §3.1  How many times a delete is retried before it is given up on. */
const MAX_DELETE_ATTEMPTS = 3;

/* -------------------------------------------------------------------------- */
/* §1  Zero-SQL 2FA persistence                                               */
/* -------------------------------------------------------------------------- */

/**
 * Key inside a user's `savedPresetsJson` that carries a copy of their TOTP
 * state. See `withTotpBackup` for why this exists.
 */
const TOTP_BACKUP_KEY = '__totpBackup';

interface TotpBackupPayload {
  totpSecret: string | null;
  totpEnabled: boolean;
  totpLastCounter: number | null;
}

/**
 * Reads a free-form JSON column into a plain object.
 *
 * `savedPresetsJson` arrives as an object from PostgREST's jsonb but is written
 * by a user-facing endpoint, so it can legitimately be null, a JSON string, or
 * (through a bad client) an array or scalar. Anything that is not a plain
 * object is treated as "no presets" rather than thrown on.
 */
function parseJsonColumn(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * §1.1  Returns a **wire copy** of the user with the TOTP state mirrored into
 * `savedPresetsJson`.
 *
 * Why: `pgUpsert` survives an unmigrated column by stripping it (PGRST204). That
 * resilience has a sharp edge — if the production `User` table lacks
 * `totpSecret` / `totpEnabled` / `totpLastCounter`, the admin's 2FA pairing is
 * silently dropped from every write and lost on the next cold start. Pairing
 * would appear to succeed and then vanish, which is worse than failing loudly.
 *
 * `savedPresetsJson` is already in the schema, so mirroring the state into it
 * gives the data a second route to Postgres that no migration can break. This
 * is a belt-and-braces copy, not a replacement: the real columns are still sent
 * and still win when present (see `restoreTotpBackup`).
 *
 * The in-memory record is never mutated — callers get a copy — so the UI can
 * never observe this key.
 */
function withTotpBackup(user: UserRecord): UserRecord {
  const backup: TotpBackupPayload = {
    totpSecret: user.totpSecret ?? null,
    totpEnabled: user.totpEnabled === true,
    totpLastCounter:
      typeof user.totpLastCounter === 'number' ? user.totpLastCounter : null,
  };
  const presets = parseJsonColumn(user.savedPresetsJson) ?? {};
  return {
    ...user,
    /* `totpEnabled` is NOT NULL in Supabase. A row hydrated from a table that
       predates the column arrives with `undefined` here, which JSON.stringify
       drops — and a missing value is rejected just as a null one would be.
       Normalising on the way out keeps every write valid. */
    totpEnabled: backup.totpEnabled,
    totpLastCounter: backup.totpLastCounter,
    savedPresetsJson: { ...presets, [TOTP_BACKUP_KEY]: backup },
  };
}

/**
 * §1.2  Reverses `withTotpBackup` on a hydrated row.
 *
 * The carrier is always stripped, so it is never exposed to the UI, and the
 * TOTP fields are restored only when the real columns came back empty (i.e.
 * they were stripped on the way in, or do not exist at all).
 *
 * Restoring is deliberately gated on `totpSecret` being absent rather than on
 * `totpEnabled`:
 *
 *  - `disableTotp` clears `totpEnabled` but keeps the secret, so a disabled
 *    account hydrates with its secret intact and is NOT restored — that would
 *    silently re-enable a second factor the owner just switched off.
 *  - `rotateTotpSecret` writes a fresh, non-null secret, so it also never
 *    triggers a restore from the older backup.
 *
 * The net effect is that the backup is consulted exactly when the columns told
 * us nothing, which is the only case this fallback is meant to cover.
 */
function restoreTotpBackup(user: UserRecord): UserRecord {
  const presets = parseJsonColumn(user.savedPresetsJson);
  const backup = presets?.[TOTP_BACKUP_KEY] as Partial<TotpBackupPayload> | undefined;

  const cleaned: Record<string, unknown> | null = presets ? { ...presets } : null;
  if (cleaned) delete cleaned[TOTP_BACKUP_KEY];

  const next: UserRecord = { ...user, savedPresetsJson: cleaned };

  if (next.totpSecret) return next;
  if (!backup || typeof backup.totpSecret !== 'string' || !backup.totpSecret) {
    return next;
  }

  next.totpSecret = backup.totpSecret;
  next.totpEnabled = backup.totpEnabled === true;
  next.totpLastCounter =
    typeof backup.totpLastCounter === 'number' ? backup.totpLastCounter : null;
  return next;
}

/**
 * §1.2  Fills in the TOTP fields on a row that predates them.
 *
 * `migrateTotpFields()` does this for the file snapshot; hydrated rows need the
 * same treatment, otherwise `totpEnabled` stays `undefined` and the NOT NULL
 * column in Supabase rejects the write.
 */
function normalizeTotpFields(user: UserRecord): UserRecord {
  if (user.totpSecret === undefined) user.totpSecret = null;
  if (user.totpEnabled === undefined) user.totpEnabled = false;
  if (user.totpLastCounter === undefined) user.totpLastCounter = null;
  return user;
}

/**
 * §13 schema, mapped onto in-memory indexes. Each `Map` is keyed by the field
 * that carried `@@id`; the §13 secondary indexes are noted per collection and
 * are enforced by `assertSchemaInvariants()` on every save.
 */
class Database {
  /** §13 User        @@id id · @@unique username */
  users = new Map<string, UserRecord>();
  /** §13 LicenseKey  @@id id · @@unique keyString · @@index([status]) */
  licenses = new Map<string, LicenseRecord>();
  /** §13 ScannerConfig @@id slug */
  scannerConfigs = new Map<ScannerSlug, ScannerConfigRow>();
  /** MODULE 6  Operator coin overrides (enable + ⚠ Monitoring Tag). */
  coinOverrides: Record<string, CoinOverrideRow> = {};
  /** §13 SystemConfig singleton (id = 'default') */
  systemConfig: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
  /** §13 RiskWatchItem @@id id · @@unique([sourceUrl]) · @@index([publishedAt]) */
  riskItems = new Map<string, RiskWatchItem>();
  /** §13 AuditLog    @@id id · @@index([createdAt]) */
  auditLogs: AuditLogRow[] = [];
  secret = '';

  private loaded = false;
  private unlockedAllAt: number | null = null;

  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    let data: DbShape | null = null;
    try {
      if (existsSync(DB_FILE)) data = JSON.parse(readFileSync(DB_FILE, 'utf8')) as DbShape;
    } catch {
      data = null;
    }
    if (!data) data = seed();

    this.users = new Map(data.users.map((u) => [u.id, u]));
    this.licenses = new Map(data.licenses.map((l) => [l.id, l]));
    this.scannerConfigs = new Map(data.scannerConfigs.map((c) => [c.slug, c]));
    this.systemConfig = { ...DEFAULT_SYSTEM_CONFIG, ...data.systemConfig };
    this.riskItems = new Map((data.riskItems ?? []).map((r) => [r.id, r]));
    this.customSignals = new Map((data.customSignals ?? []).map((c) => [c.id, c]));
    this.auditLogs = data.auditLogs ?? [];
    /* Prefer the pinned env secret so sessions survive a serverless cold start. */
    this.secret = SESSION_SECRET || data.secret || randomBytes(32).toString('hex');
    this.unlockedAllAt = data.unlockedAllAt ?? null;

    /* §2.2  Upgrade-in-place: any snapshot written before the "one key unlocks
       everything" change still carries per-scanner false flags. Promote every
       user and every license to the full entitlement set exactly once, then
       persist so the migration is durable. */
    this.migrateUnlockAll();
    this.migrateSystemConfig();
    this.migrateSeedKeyLimits();
    this.migrateTotpFields();
    this.persist();
  }

  /**
   * §2.2  One-time promotion of every stored user/license to full access.
   * Idempotent: re-running on an already-migrated snapshot is a no-op that
   * skips the write (tracked by `unlockedAllAt` on the persisted shape).
   */
  private migrateUnlockAll(): void {
    if (this.unlockedAllAt !== null) return;

    let touched = false;
    for (const u of this.users.values()) {
      for (const k of ENTITLEMENT_KEYS) {
        if (!u[k]) {
          u[k] = true;
          touched = true;
        }
      }
      if (u.plan !== 'ULTRA_PRO') {
        u.plan = 'ULTRA_PRO';
        touched = true;
      }
    }
    for (const l of this.licenses.values()) {
      for (const k of GRANT_KEYS) {
        if (!l[k]) {
          l[k] = true;
          touched = true;
        }
      }
    }
    if (touched) {
      this.auditLogs.unshift({
        id: randomUUID(),
        adminUsername: 'system',
        action: 'MIGRATE_UNLOCK_ALL',
        targetId: null,
        createdAt: Date.now(),
      });
    }
    this.unlockedAllAt = Date.now();
  }

  /**
   * §1.2  Raise the device/duration limits on the two seeded keys.
   *
   * A fresh install picks these up from `seed()`, but any existing `.data`
   * snapshot still carries the old 7d / 1-device trial and the 3-device admin
   * key. Without this, upgrading would leave `demo` throwing LICENSE_IN_USE
   * the moment you opened a second browser — exactly the bug §1.2 exists to
   * remove. Idempotent: only writes if a value is still below the new floor.
   */
  private migrateSeedKeyLimits(): void {
    const floor: Array<{ key: string; maxDevices: number; durationDays: number }> = [
      { key: 'APS-9F4A-22C1-88E0', maxDevices: 99, durationDays: 3650 },
      { key: 'APS-TRIAL-AA17-K4M2', maxDevices: 25, durationDays: 90 },
    ];

    for (const spec of floor) {
      const lic = this.licenseByKey(spec.key);
      if (!lic) continue;
      let touched = false;
      if (lic.maxDevices < spec.maxDevices) {
        lic.maxDevices = spec.maxDevices;
        touched = true;
      }
      if (lic.durationDays < spec.durationDays) {
        lic.durationDays = spec.durationDays;
        touched = true;
      }
      if (touched) this.audit('system', 'MIGRATE_KEY_LIMITS', lic.id);
    }
  }

  /** §1.1  Drop fields retired by the legacy brand purge from stored config. */
  /**
   * §2.2  Back-fill the authenticator fields onto rows that predate them.
   *
   * The fields are optional on `UserRecord`, so an old snapshot type-checks but
   * leaves them `undefined`. Normalising to explicit nulls/false here means the
   * rest of the code can treat `user.totpEnabled` as a plain boolean without
   * defending against `undefined` at every call site, and Postgres always gets
   * concrete values rather than omitted keys.
   */
  private migrateTotpFields(): void {
    for (const u of this.users.values()) {
      if (u.totpSecret === undefined) u.totpSecret = null;
      if (u.totpEnabled === undefined) u.totpEnabled = false;
      if (u.totpLastCounter === undefined) u.totpLastCounter = null;
    }
  }

  private migrateSystemConfig(): void {
    const legacy = this.systemConfig as unknown as Record<string, unknown>;
    delete legacy.tutorialVideo1Url;
    delete legacy.tutorialVideo2Url;
    if (legacy.versionBadge === 'Lite v1.2.8') legacy.versionBadge = DEFAULT_SYSTEM_CONFIG.versionBadge;
  }

  /**
   * §13 — enforce the `@@unique` constraints Prisma would have enforced.
   * Runs before every persist so a bug can never write a snapshot that the
   * real schema would have rejected.
   */
  private assertSchemaInvariants(): void {
    const seenUsernames = new Set<string>();
    for (const u of this.users.values()) {
      const key = u.username.toLowerCase();
      if (seenUsernames.has(key)) throw new Error(`§13 User.username unique violation: ${u.username}`);
      seenUsernames.add(key);
    }

    const seenKeys = new Set<string>();
    for (const l of this.licenses.values()) {
      if (seenKeys.has(l.keyString)) {
        throw new Error(`§13 LicenseKey.keyString unique violation: ${l.keyString}`);
      }
      seenKeys.add(l.keyString);
    }

    // §13 RiskWatchItem @@unique([sourceUrl]) — upserts key on this.
    const seenUrls = new Set<string>();
    for (const r of this.riskItems.values()) {
      if (seenUrls.has(r.sourceUrl)) {
        throw new Error(`§13 RiskWatchItem.sourceUrl unique violation: ${r.sourceUrl}`);
      }
      seenUrls.add(r.sourceUrl);
    }
  }

  /* -------------------- §3  Postgres durability layer ------------------- */

  /** §3.1  Queues a row for deletion from Postgres on the next flush. */
  private queueDelete(table: string, column: string, value: string): void {
    if (!value) return;
    this.pendingDeletes.push({ table, column, value, attempts: 0 });
  }

  /**
   * §3.1  Replays queued deletions against Postgres.
   *
   * A delete that fails is put back on the queue so the next flush retries it —
   * dropping it on a transient network error would silently resurrect the row
   * on the following cold start, which is the exact bug this is here to fix.
   * The retry is bounded so a permanently unreachable Postgres cannot grow the
   * queue without limit.
   */
  private async drainPendingDeletes(): Promise<void> {
    if (this.pendingDeletes.length === 0) return;
    /* Nothing is mirrored, so nothing needs deleting. */
    if (!pgEnabled()) {
      this.pendingDeletes = [];
      return;
    }

    const batch = this.pendingDeletes;
    this.pendingDeletes = [];

    const retry: PendingDelete[] = [];
    for (const d of batch) {
      if (await pgDeleteById(d.table, d.column, d.value)) continue;
      if (d.attempts + 1 < MAX_DELETE_ATTEMPTS) retry.push({ ...d, attempts: d.attempts + 1 });
    }
    this.pendingDeletes = retry.concat(this.pendingDeletes);
  }

  /**
   * §3.1  Rows removed since the last flush.
   *
   * A delete has to be replayed against Postgres explicitly: the mirror is
   * otherwise upsert-only, so a removed user or license key stayed in the
   * table and `hydrateFromPostgres()` resurrected it on the next cold start.
   */
  private pendingDeletes: PendingDelete[] = [];

  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<void> | null = null;

  /**
   * Replace the in-memory maps with whatever Postgres holds.
   *
   * Called once from engine boot. Each table is only adopted when it actually
   * has rows, so a brand-new Postgres (or an unreachable one) leaves the file
   * store's seed untouched instead of wiping it.
   */
  /**
   * §8.2  Hydrate once per process, then hand back the cached promise.
   *
   * On a serverless host every cold start builds a fresh `Database` seeded with
   * default users. If a request is served before hydration completes, that seed
   * is what the caller sees — and `persist()` will then happily write it over
   * the real rows in Postgres. That is how live users, passwords and 2FA
   * secrets get clobbered by default data.
   *
   * Every auth and admin entry point therefore awaits this first. The promise
   * is cached so concurrent requests share one round trip, and a failure is
   * remembered as "resolved" so a broken Postgres degrades to the in-memory
   * store rather than retrying on every single request.
   */
  private hydration: Promise<boolean> | null = null;

  ensureHydrated(): Promise<boolean> {
    if (!pgEnabled()) return Promise.resolve(false);
    if (!this.hydration) {
      this.hydration = this.hydrateFromPostgres().catch(() => false);
    }
    return this.hydration;
  }

  /**
   * Test seam: forget the cached hydration so a suite can observe a genuine
   * re-hydration. Production code must not call this.
   */
  resetHydration(): void {
    this.hydration = null;
  }

  async hydrateFromPostgres(): Promise<boolean> {
    if (!pgEnabled()) return false;
    try {
      const [users, licenses, configs, sysRows, coins, signals, riskItems, auditLogs] = await Promise.all([
        pgSelect<UserRecord>(PG_TABLES.users),
        pgSelect<LicenseRecord>(PG_TABLES.licenses),
        pgSelect<ScannerConfigRow>(PG_TABLES.scannerConfigs),
        pgSelect<Record<string, unknown>>(PG_TABLES.systemConfig, 'select=*&id=eq.1'),
        pgSelect<CoinOverrideRow>(PG_TABLES.coins),
        pgSelect<CustomSignal>(PG_TABLES.signals),
        pgSelect<RiskWatchItem>(PG_TABLES.riskItems),
        pgSelect<AuditLogRow>(PG_TABLES.auditLogs, 'select=*&order=createdAt.desc&limit=500'),
      ]);

      let hydrated = false;

      if (users?.length) {
        /* §1.2  Rehydrate 2FA from the `savedPresetsJson` copy when the real
           columns were stripped on write. See `restoreTotpBackup`. */
        this.users = new Map(
          users.map((u) => [u.id, normalizeTotpFields(restoreTotpBackup(u))]),
        );
        hydrated = true;
      }
      if (licenses?.length) {
        this.licenses = new Map(licenses.map((l) => [l.id, l]));
        hydrated = true;
      }
      if (configs?.length) {
        this.scannerConfigs = new Map(configs.map((c) => [c.slug, c]));
        hydrated = true;
      }
      if (sysRows?.length) {
        this.systemConfig = toSystemConfigRow(sysRows[0]);
        hydrated = true;
      }
      if (coins?.length) {
        this.coinOverrides = Object.fromEntries(coins.map((c) => [c.symbol, c]));
        hydrated = true;
      }
      if (signals?.length) {
        this.customSignals = new Map(signals.map((c) => [c.id, c]));
        hydrated = true;
      }
      if (riskItems?.length) {
        this.riskItems = new Map(riskItems.map((r) => [r.id, r]));
        hydrated = true;
      }
      if (auditLogs?.length) {
        this.auditLogs = auditLogs.slice(0, 500);
        hydrated = true;
      }

      if (hydrated) console.log('[db] hydrated from Supabase Postgres');
      return hydrated;
    } catch {
      /* Postgres unreachable — keep serving from the in-memory store. */
      return false;
    }
  }

  /** Debounced write-behind so a burst of mutations costs one round trip. */
  private schedulePostgresSync(): void {
    if (!pgEnabled()) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.flushToPostgres();
    }, 150);
    this.syncTimer.unref?.();
  }

  /**
   * Push the current in-memory state to Postgres.
   *
   * Safe to call concurrently: overlapping calls share one in-flight promise,
   * and a caller that needs the write to land before it returns (an admin API
   * route on serverless, where the process may freeze) can await it directly.
   */
  async flushToPostgres(): Promise<void> {
    if (!pgEnabled()) return;
    if (this.syncing) return this.syncing;

    this.syncing = (async () => {
      try {
        /* Deletions first. `pgUpsert` only ever writes rows that are still in
           memory, so a row removed here would otherwise survive in Postgres
           and come back on the next cold start. Draining the queue before the
           upserts also means a delete + recreate of the same id in one tick
           ends in the correct final state. */
        await this.drainPendingDeletes();
        /* §1.1  Mirror each user's TOTP state into `savedPresetsJson`, which is
           already in the schema, so 2FA survives even if the `totp*` columns
           have not been migrated. See `withTotpBackup`. */
        await pgUpsert(PG_TABLES.users, [...this.users.values()].map(withTotpBackup), 'id');
        await pgUpsert(PG_TABLES.licenses, [...this.licenses.values()], 'id');
        await pgUpsert(PG_TABLES.scannerConfigs, [...this.scannerConfigs.values()], 'slug');
        await pgUpsert(PG_TABLES.systemConfig, [{ id: 1, ...this.systemConfig }], 'id');
        await pgUpsert(PG_TABLES.coins, Object.values(this.coinOverrides), 'symbol');
        await pgUpsert(PG_TABLES.signals, [...this.customSignals.values()], 'id');
        await pgUpsert(PG_TABLES.riskItems, [...this.riskItems.values()], 'id');
        await pgUpsert(PG_TABLES.auditLogs, this.auditLogs.slice(0, 500), 'id');
      } catch {
        /* Durability is best-effort; never take the engine down for it. */
      }
    })();

    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  persist(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      const shape: DbShape = {
        users: [...this.users.values()],
        licenses: [...this.licenses.values()],
        scannerConfigs: [...this.scannerConfigs.values()],
        systemConfig: this.systemConfig,
        riskItems: [...this.riskItems.values()],
        customSignals: [...this.customSignals.values()],
        auditLogs: this.auditLogs.slice(0, 500),
        coinOverrides: this.coinOverrides,
        secret: this.secret,
        unlockedAllAt: this.unlockedAllAt,
      };
      this.assertSchemaInvariants();
      writeFileSync(DB_FILE, JSON.stringify(shape, null, 2));
    } catch {
      /* Read-only filesystem — operate purely in memory. */
    }
    /* Mirror to Postgres regardless: on a serverless host the file write above
       is the part that will not survive, not the mirror. */
    this.schedulePostgresSync();
  }

  /* ------------------------------- users -------------------------------- */

  userByUsername(username: string): UserRecord | undefined {
    for (const u of this.users.values()) if (u.username.toLowerCase() === username.toLowerCase()) return u;
    return undefined;
  }

  userById(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

  entitlementsOf(u: UserRecord): Entitlements {
    return {
      canAccessV1Scaling: u.canAccessV1Scaling,
      canAccessOrderBlock: u.canAccessOrderBlock,
      canAccessEmaCrossover: u.canAccessEmaCrossover,
      canAccessHiddenBullish: u.canAccessHiddenBullish,
      canAccessAlphaSniper: u.canAccessAlphaSniper,
    };
  }

  licenseOf(u: UserRecord): LicenseRecord | undefined {
    if (u.licenseKeyId) return this.licenses.get(u.licenseKeyId);
    for (const l of this.licenses.values()) if (l.assignedUserId === u.id) return l;
    return undefined;
  }

  createUser(input: { username: string; password: string; whatsappNumber?: string | null; role?: Role; plan?: PlanTier }): UserRecord {
    const u: UserRecord = {
      id: randomUUID(),
      username: input.username,
      email: null,
      passwordHash: hashPassword(input.password),
      whatsappNumber: input.whatsappNumber ?? null,
      role: input.role ?? 'USER',
      plan: input.plan ?? 'LITE',
      isSuspended: false,
      ...LITE_ENTITLEMENTS,
      preferredTimeframe: '1H',
      tileDensity: 'COMFORTABLE',
      soundEnabled: false,
      chartMode: 'EXTERNAL_TV',
      timezonePref: 'Asia/Karachi',
      watchlistSymbols: [],
      savedPresetsJson: null,
      acceptedDisclaimerAt: null,
      licenseKeyId: null,
      createdAt: Date.now(),
      lastSeenAt: null,
    };
    this.users.set(u.id, u);
    this.persist();
    return u;
  }

  setEntitlement(u: UserRecord, key: EntitlementKey, value: boolean): void {
    u[key] = value;
    this.persist();
  }

  /* ------------------------------ licenses ------------------------------ */

  licenseByKey(keyString: string): LicenseRecord | undefined {
    const needle = keyString.trim().toUpperCase();
    for (const l of this.licenses.values()) if (l.keyString.toUpperCase() === needle) return l;
    return undefined;
  }

  createLicense(input: {
    plan: PlanTier;
    durationDays: number;
    grants: Entitlements;
    maxDevices?: number;
  }): LicenseRecord {
    const l: LicenseRecord = {
      id: randomUUID(),
      keyString: generateLicenseKey(),
      status: 'ACTIVE',
      plan: input.plan,
      durationDays: input.durationDays,
      maxDevices: input.maxDevices ?? (input.plan === 'ULTRA_PRO' ? 3 : 1),
      activeDeviceHashes: [],
      ...grantsFrom(input.grants),
      assignedUserId: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: Date.now(),
    };
    this.licenses.set(l.id, l);
    this.persist();
    return l;
  }

  isLicenseUsable(l: LicenseRecord): boolean {
    if (l.status !== 'ACTIVE') return false;
    if (l.expiresAt !== null && l.expiresAt < Date.now()) return false;
    return true;
  }

  /* ------------------------------- audit -------------------------------- */

  audit(adminUsername: string, action: string, targetId: string | null = null): void {
    this.auditLogs.unshift({ id: randomUUID(), adminUsername, action, targetId, createdAt: Date.now() });
    this.auditLogs = this.auditLogs.slice(0, 500);
    this.persist();
  }

  /* --------------------- license lifecycle (MODULES 3 & 4) --------------- */

  /**
   * MODULE 3/4  Clear `activeDeviceHashes` so a customer who hit
   * LICENSE_IN_USE after changing phone or browser can sign straight back in.
   */
  resetLicenseDevices(licenseId: string): LicenseRecord | null {
    const lic = this.licenses.get(licenseId);
    if (!lic) return null;
    lic.activeDeviceHashes = [];
    this.persist();
    return lic;
  }

  /**
   * MODULE 3  Add days to `expiresAt`, measured from *now* when the key has
   * already lapsed — extending an expired key by 30d must give 30 usable days,
   * not 30 days from a timestamp in the past. Reactivates and starts the
   * clock on a key that was never activated or had expired.
   */
  extendLicense(licenseId: string, days: number): LicenseRecord | null {
    if (!Number.isFinite(days) || days <= 0) return null;
    const lic = this.licenses.get(licenseId);
    if (!lic) return null;

    const now = Date.now();
    const base = lic.expiresAt !== null && lic.expiresAt > now ? lic.expiresAt : now;
    lic.expiresAt = base + Math.round(days * 86_400_000);
    if (lic.activatedAt === null) lic.activatedAt = now;
    if (lic.status === 'EXPIRED') lic.status = 'ACTIVE';
    lic.durationDays = Math.max(lic.durationDays, Math.round((lic.expiresAt - (lic.activatedAt ?? now)) / 86_400_000));
    this.persist();
    return lic;
  }

  /** MODULE 3  Inline max-device change (1 / 2 / 5 / 99). */
  setLicenseMaxDevices(licenseId: string, maxDevices: number): LicenseRecord | null {
    const lic = this.licenses.get(licenseId);
    if (!lic) return null;
    const next = Math.max(1, Math.min(99, Math.round(maxDevices)));
    /* Truncate any already-registered devices down to the new ceiling so the
       row never reports more devices than are allowed. */
    if (lic.activeDeviceHashes.length > next) lic.activeDeviceHashes = lic.activeDeviceHashes.slice(0, next);
    lic.maxDevices = next;
    this.persist();
    return lic;
  }

  /** MODULE 3  ACTIVE <-> REVOKED. Revoking drops live sessions immediately. */
  setLicenseStatus(licenseId: string, status: 'ACTIVE' | 'REVOKED'): LicenseRecord | null {
    const lic = this.licenses.get(licenseId);
    if (!lic) return null;
    lic.status = status;
    if (status === 'REVOKED') lic.activeDeviceHashes = [];
    this.persist();
    return lic;
  }

  /**
   * MODULE 3  Delete a user permanently.
   *
   * §3.1  Removes the row from memory, from the on-disk snapshot and — via the
   * delete queue — from Supabase Postgres, so the next cold start cannot
   * resurrect them.
   *
   * Two deliberate guards:
   *   • The last remaining admin cannot be deleted. Doing so would leave the
   *     portal permanently unreachable with no way back in.
   *   • The user's license key is *released*, not deleted. It returns to the
   *     vault as an unassigned key the admin can hand to someone else; the
   *     customer's access ends either way because their account is gone.
   */
  deleteUser(userId: string): { ok: true } | { ok: false; error: string } {
    const user = this.userById(userId);
    if (!user) return { ok: false, error: 'NOT_FOUND' };

    if (user.role === 'ADMIN') {
      const admins = [...this.users.values()].filter((u) => u.role === 'ADMIN').length;
      if (admins <= 1) return { ok: false, error: 'LAST_ADMIN' };
    }

    /* Release the key so it can be reassigned, and clear its device locks so
       the next holder is not blocked by the previous one's fingerprints. */
    if (user.licenseKeyId) {
      const lic = this.licenses.get(user.licenseKeyId);
      if (lic) {
        lic.assignedUserId = null;
        lic.activeDeviceHashes = [];
      }
    }

    this.users.delete(userId);
    this.queueDelete(PG_TABLES.users, 'id', userId);
    this.persist();
    return { ok: true };
  }

  /**
   * MODULE 3  Delete a key. Refuses anything that is currently assigned AND
   * active — deleting those would lock a paying customer out with no audit
   * trail of who did it.
   */
  deleteLicense(licenseId: string): { ok: true } | { ok: false; error: string } {
    const lic = this.licenses.get(licenseId);
    if (!lic) return { ok: false, error: 'NOT_FOUND' };
    if (lic.assignedUserId && lic.status === 'ACTIVE') {
      return { ok: false, error: 'ASSIGNED_AND_ACTIVE' };
    }

    /* Unbind from the user so their record never points at a dead key. */
    if (lic.assignedUserId) {
      const u = this.userById(lic.assignedUserId);
      if (u && u.licenseKeyId === lic.id) u.licenseKeyId = null;
    }
    this.licenses.delete(licenseId);
    /* §3.1  Mirror the removal, or hydration brings the key back. */
    this.queueDelete(PG_TABLES.licenses, 'id', licenseId);
    this.persist();
    return { ok: true };
  }

  /* --------------------------- §2.2  admin TOTP --------------------------- */

  /**
   * §2.2  Returns (creating on first call) the admin's TOTP setup material.
   *
   * The secret is generated once and then kept, so re-opening the pairing
   * wizard shows the *same* QR code rather than silently invalidating one the
   * admin may have already scanned. `totpEnabled` stays false until a code from
   * this secret has been verified — that is what guarantees no lockout: seeing
   * the QR code never by itself turns on the requirement.
   */
  totpSetup(userId: string): { secret: string; uri: string; enabled: boolean } | null {
    const u = this.userById(userId);
    if (!u) return null;
    if (!u.totpSecret) {
      u.totpSecret = generateTotpSecret();
      this.persist();
    }
    return {
      secret: u.totpSecret,
      uri: totpUri({ secret: u.totpSecret, accountName: u.username }),
      enabled: u.totpEnabled === true,
    };
  }

  /** §2.2  Regenerates the secret. Always disables 2FA — see rotate note below. */
  rotateTotpSecret(userId: string): { secret: string; uri: string; enabled: boolean } | null {
    const u = this.userById(userId);
    if (!u) return null;
    u.totpSecret = generateTotpSecret();
    /* A rotated secret invalidates the phone that is currently paired, so the
       requirement is switched off until the new QR has been verified. Leaving
       it on would lock the admin out with a code they can no longer produce. */
    u.totpEnabled = false;
    u.totpLastCounter = null;
    this.persist();
    return {
      secret: u.totpSecret,
      uri: totpUri({ secret: u.totpSecret, accountName: u.username }),
      enabled: false,
    };
  }

  /**
   * §2.2  Verifies a code for **sign-in**, with replay protection.
   *
   * Replay protection is deliberately scoped to authentication. A code that has
   * already been spent to log in is refused, so a code captured over the
   * shoulder cannot be replayed inside its 30-second window.
   *
   * It is *not* applied to the management actions below. Those run against an
   * already-authenticated admin session, and gating them on the counter made
   * legitimate sequences fail: enabling 2FA consumed the step's counter, so
   * disabling or re-verifying during the same 30 seconds was rejected.
   */
  verifyTotpForLogin(userId: string, code: string): { ok: boolean; error?: string } {
    const u = this.userById(userId);
    if (!u) return { ok: false, error: 'NOT_FOUND' };
    if (!u.totpSecret) return { ok: false, error: 'NO_SECRET' };

    const result = verifyTotp(u.totpSecret, code, { lastCounter: u.totpLastCounter ?? undefined });
    if (!result.ok) return { ok: false, error: 'BAD_CODE' };

    u.totpLastCounter = result.counter ?? null;
    this.persist();
    return { ok: true };
  }

  /** §2.2  Verifies a code and turns the requirement on. */
  verifyAndEnableTotp(userId: string, code: string): { ok: boolean; error?: string } {
    const u = this.userById(userId);
    if (!u) return { ok: false, error: 'NOT_FOUND' };
    if (!u.totpSecret) return { ok: false, error: 'NO_SECRET' };
    if (!verifyTotp(u.totpSecret, code).ok) return { ok: false, error: 'BAD_CODE' };

    u.totpEnabled = true;
    this.persist();
    return { ok: true };
  }

  /**
   * §2.2  Turns the requirement off.
   *
   * When 2FA is on, a valid current code is required first — otherwise anyone
   * holding an admin session could silently strip the owner's only second
   * factor.
   */
  disableTotp(userId: string, code?: string): { ok: boolean; error?: string } {
    const u = this.userById(userId);
    if (!u) return { ok: false, error: 'NOT_FOUND' };
    if (u.totpEnabled === true) {
      if (!code) return { ok: false, error: 'CODE_REQUIRED' };
      if (!u.totpSecret) return { ok: false, error: 'NO_SECRET' };
      if (!verifyTotp(u.totpSecret, code).ok) return { ok: false, error: 'BAD_CODE' };
    }
    u.totpEnabled = false;
    this.persist();
    return { ok: true };
  }

  /** §2.2  Validates a code against the user's stored secret (no state change). */
  checkTotp(userId: string, code: string): { ok: boolean; error?: string } {
    const u = this.userById(userId);
    if (!u) return { ok: false, error: 'NOT_FOUND' };
    if (!u.totpSecret) return { ok: false, error: 'NO_SECRET' };
    const result = verifyTotp(u.totpSecret, code);
    return result.ok ? { ok: true } : { ok: false, error: 'BAD_CODE' };
  }

  /** MODULE 3/4  Bind (or swap) a key onto a user, syncing entitlements. */
  bindLicense(licenseId: string, userId: string): { ok: true } | { ok: false; error: string } {
    const lic = this.licenses.get(licenseId);
    const user = this.userById(userId);
    if (!lic || !user) return { ok: false, error: 'NOT_FOUND' };

    /* Release whatever the user was holding, and whoever held this key. */
    const prev = user.licenseKeyId ? this.licenses.get(user.licenseKeyId) : undefined;
    if (prev && prev.id !== lic.id) prev.assignedUserId = null;
    if (lic.assignedUserId && lic.assignedUserId !== user.id) {
      const other = this.userById(lic.assignedUserId);
      if (other && other.licenseKeyId === lic.id) other.licenseKeyId = null;
    }

    lic.assignedUserId = user.id;
    user.licenseKeyId = lic.id;
    user.canAccessV1Scaling = lic.grantV1Scaling;
    user.canAccessOrderBlock = lic.grantOrderBlock;
    user.canAccessEmaCrossover = lic.grantEmaCrossover;
    user.canAccessHiddenBullish = lic.grantHiddenBullish;
    user.canAccessAlphaSniper = lic.grantAlphaSniper;
    user.plan = lic.plan;
    this.persist();
    return { ok: true };
  }

  /**
   * MODULE 2  Atomic onboarding: create user -> mint key -> bind -> activate.
   *
   * Deliberately one call so a failure mid-way cannot leave an account with no
   * key (or a key with no owner). The whole thing rolls back on any error.
   */
  onboardCustomer(input: {
    username: string;
    password: string;
    whatsappNumber?: string | null;
    durationDays: number;
    maxDevices: number;
    grants: Entitlements;
  }): { ok: true; user: UserRecord; license: LicenseRecord } | { ok: false; error: string } {
    const username = input.username.trim();
    if (!username || !input.password) return { ok: false, error: 'MISSING_FIELDS' };
    if (this.userByUsername(username)) return { ok: false, error: 'USERNAME_TAKEN' };

    const before = {
      users: new Map(this.users),
      licenses: new Map(this.licenses),
      auditLen: this.auditLogs.length,
    };

    try {
      const user = this.createUser({
        username,
        password: input.password,
        whatsappNumber: input.whatsappNumber ?? null,
      });
      const license = this.createLicense({
        plan: 'ULTRA_PRO',
        durationDays: input.durationDays,
        grants: input.grants,
        maxDevices: input.maxDevices,
      });

      const bound = this.bindLicense(license.id, user.id);
      if (!bound.ok) throw new Error(bound.error);

      /* Activate the countdown now — the customer is paying from today. */
      const now = Date.now();
      license.activatedAt = now;
      license.expiresAt = now + Math.round(input.durationDays * 86_400_000);
      this.persist();

      return { ok: true, user, license };
    } catch {
      this.users = before.users;
      this.licenses = before.licenses;
      this.auditLogs = this.auditLogs.slice(0, before.auditLen);
      this.persist();
      return { ok: false, error: 'ONBOARD_FAILED' };
    }
  }

  /* --------------------- custom VIP signals (MODULE 6) ------------------- */

  customSignals = new Map<string, CustomSignal>();

  publishCustomSignal(input: Omit<CustomSignal, 'id' | 'createdAt' | 'validUntil'>, ttlMs: number | null = null): CustomSignal {
    const sig: CustomSignal = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now(),
      validUntil: ttlMs === null ? null : Date.now() + ttlMs,
    };
    this.customSignals.set(sig.id, sig);
    this.persist();
    return sig;
  }

  deleteCustomSignal(id: string): boolean {
    const gone = this.customSignals.delete(id);
    if (gone) this.persist();
    return gone;
  }

  listCustomSignals(): CustomSignal[] {
    const now = Date.now();
    return [...this.customSignals.values()]
      .filter((s) => s.validUntil === null || s.validUntil > now)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /* ---------------------- risk watch CMS (MODULE 7) ---------------------- */

  deleteRiskItem(id: string): boolean {
    const gone = this.riskItems.delete(id);
    if (gone) this.persist();
    return gone;
  }

  setRiskItemPinned(id: string, isPinned: boolean): RiskWatchItem | null {
    const item = this.riskItems.get(id);
    if (!item) return null;
    item.isPinned = isPinned;
    this.persist();
    return item;
  }

  addRiskItem(input: Omit<RiskWatchItem, 'id'>): RiskWatchItem {
    const item: RiskWatchItem = { ...input, id: randomUUID() };
    this.riskItems.set(item.id, item);
    this.persist();
    return item;
  }

  /* ------------------------ backup & restore (MODULE 9) ------------------ */

  /** MODULE 9  Full state export — everything needed to rebuild from scratch. */
  /* ------------------------------ coins (§6) ----------------------------- */

  /** Record an operator override and persist it so it survives a restart. */
  setCoinOverride(
    symbol: string,
    patch: { enabled?: boolean; isMonitoringTag?: boolean },
  ): CoinOverrideRow {
    const prev = this.coinOverrides[symbol];
    const next: CoinOverrideRow = {
      symbol,
      enabled: patch.enabled ?? prev?.enabled ?? true,
      isMonitoringTag: patch.isMonitoringTag ?? prev?.isMonitoringTag ?? false,
      manualTagOverride: patch.isMonitoringTag !== undefined ? true : (prev?.manualTagOverride ?? false),
      updatedAt: Date.now(),
    };
    this.coinOverrides[symbol] = next;
    this.persist();
    return next;
  }

  exportSnapshot(): DbSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      exportedAt: Date.now(),
      users: [...this.users.values()],
      licenses: [...this.licenses.values()],
      scannerConfigs: [...this.scannerConfigs.values()],
      systemConfig: this.systemConfig,
      riskItems: [...this.riskItems.values()],
      customSignals: [...this.customSignals.values()],
      auditLogs: this.auditLogs,
      coinOverrides: Object.values(this.coinOverrides),
    };
  }

  /**
   * MODULE 9  NON-DESTRUCTIVE restore.
   *
   * Every collection is merged by id, so a backup taken from a different
   * environment adds missing records without deleting anything the running
   * install currently holds. `secret` is never imported — adopting a foreign
   * signing secret would invalidate every live session token.
   */
  importSnapshot(snap: unknown): { ok: true; counts: Record<string, number> } | { ok: false; error: string } {
    if (!snap || typeof snap !== 'object') return { ok: false, error: 'BAD_PAYLOAD' };
    const s = snap as Partial<DbSnapshot>;
    if (!Array.isArray(s.users) && !Array.isArray(s.licenses) && !s.systemConfig) {
      return { ok: false, error: 'BAD_PAYLOAD' };
    }

    const counts: Record<string, number> = {
      users: 0,
      licenses: 0,
      scannerConfigs: 0,
      riskItems: 0,
      customSignals: 0,
      coinOverrides: 0,
    };

    for (const u of s.users ?? []) {
      if (!u?.id || !u.username) continue;
      if (!this.users.has(u.id)) {
        this.users.set(u.id, u);
        counts.users += 1;
      }
    }
    for (const l of s.licenses ?? []) {
      if (!l?.id || !l.keyString) continue;
      if (!this.licenses.has(l.id)) {
        this.licenses.set(l.id, l);
        counts.licenses += 1;
      }
    }
    for (const c of s.scannerConfigs ?? []) {
      if (!c?.slug) continue;
      if (!this.scannerConfigs.has(c.slug)) {
        this.scannerConfigs.set(c.slug, c);
        counts.scannerConfigs += 1;
      }
    }
    for (const r of s.riskItems ?? []) {
      if (!r?.id) continue;
      if (!this.riskItems.has(r.id)) {
        this.riskItems.set(r.id, r);
        counts.riskItems += 1;
      }
    }
    for (const sig of s.customSignals ?? []) {
      if (!sig?.id) continue;
      if (!this.customSignals.has(sig.id)) {
        this.customSignals.set(sig.id, sig);
        counts.customSignals += 1;
      }
    }
    for (const c of s.coinOverrides ?? []) {
      if (!c?.symbol) continue;
      /* Newest wins: a backup taken later reflects the operator's latest
         intent, so it replaces an older stored override. */
      const prev = this.coinOverrides[c.symbol];
      if (!prev || c.updatedAt >= prev.updatedAt) {
        this.coinOverrides[c.symbol] = c;
        counts.coinOverrides += 1;
      }
    }
    if (s.systemConfig && typeof s.systemConfig === 'object') {
      this.systemConfig = { ...this.systemConfig, ...s.systemConfig };
    }

    this.assertSchemaInvariants();
    this.persist();
    return { ok: true, counts };
  }

  /* ----------------------------- risk watch ----------------------------- */

  upsertRiskItem(item: RiskWatchItem): void {
    this.riskItems.set(item.id, item);
  }

  riskItemByUrl(url: string): RiskWatchItem | undefined {
    for (const r of this.riskItems.values()) if (r.sourceUrl === url) return r;
    return undefined;
  }
}

const GLOBAL_KEY = '__alpha_x_db__';

export function getDb(): Database {
  const g = globalThis as unknown as Record<string, Database | undefined>;
  if (!g[GLOBAL_KEY]) {
    const db = new Database();
    db.load();
    g[GLOBAL_KEY] = db;
  }
  return g[GLOBAL_KEY] as Database;
}

export type { Database };
export { ALL_ENTITLEMENTS, LITE_ENTITLEMENTS, MONITORING_TAG_SYMBOLS, dirname };
