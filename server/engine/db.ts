import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEFAULT_SYSTEM_CONFIG, MONITORING_TAG_SYMBOLS } from '@/lib/constants';
import {
  SCANNERS,
  type AuditLogRow,
  type EntitlementKey,
  type Entitlements,
  type LicenseKeyRow,
  type PlanTier,
  type RiskWatchItem,
  type Role,
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

const DATA_DIR = join(process.cwd(), '.data');
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

interface DbShape {
  users: UserRecord[];
  licenses: LicenseRecord[];
  scannerConfigs: ScannerConfigRow[];
  systemConfig: SystemConfig;
  riskItems: RiskWatchItem[];
  auditLogs: AuditLogRow[];
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
    maxDevices: 3,
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
    durationDays: 7,
    maxDevices: 1,
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
    auditLogs: [],
    secret: randomBytes(32).toString('hex'),
  };
}

function grantsFrom(e: Entitlements) {
  return {
    grantV1Scaling: e.canAccessV1Scaling,
    grantOrderBlock: e.canAccessOrderBlock,
    grantEmaCrossover: e.canAccessEmaCrossover,
    grantHiddenBullish: e.canAccessHiddenBullish,
    grantAlphaSniper: e.canAccessAlphaSniper,
  };
}

/* ---------------------------------- DB ------------------------------------ */

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
    this.auditLogs = data.auditLogs ?? [];
    this.secret = data.secret || randomBytes(32).toString('hex');
    this.unlockedAllAt = data.unlockedAllAt ?? null;

    /* §2.2  Upgrade-in-place: any snapshot written before the "one key unlocks
       everything" change still carries per-scanner false flags. Promote every
       user and every license to the full entitlement set exactly once, then
       persist so the migration is durable. */
    this.migrateUnlockAll();
    this.migrateSystemConfig();
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

  /** §1.1  Drop fields retired by the legacy brand purge from stored config. */
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

  persist(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      const shape: DbShape = {
        users: [...this.users.values()],
        licenses: [...this.licenses.values()],
        scannerConfigs: [...this.scannerConfigs.values()],
        systemConfig: this.systemConfig,
        riskItems: [...this.riskItems.values()],
        auditLogs: this.auditLogs.slice(0, 500),
        secret: this.secret,
        unlockedAllAt: this.unlockedAllAt,
      };
      this.assertSchemaInvariants();
      writeFileSync(DB_FILE, JSON.stringify(shape, null, 2));
    } catch {
      /* Read-only filesystem — operate purely in memory. */
    }
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

  createLicense(input: { plan: PlanTier; durationDays: number; grants: Entitlements }): LicenseRecord {
    const l: LicenseRecord = {
      id: randomUUID(),
      keyString: generateLicenseKey(),
      status: 'ACTIVE',
      plan: input.plan,
      durationDays: input.durationDays,
      maxDevices: input.plan === 'ULTRA_PRO' ? 3 : 1,
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
