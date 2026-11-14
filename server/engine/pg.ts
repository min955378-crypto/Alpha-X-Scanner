import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';

/**
 * §3  Supabase Postgres repository.
 *
 * The engine's Database is an in-memory store that mirrors §13's Prisma models
 * as plain TypeScript row types. On a serverless host there is no writable disk
 * and no long-lived process, so this module adds a durable backing store:
 *
 *   • `hydrateFromPostgres()` — called once during engine boot, replaces the
 *     in-memory maps with whatever Postgres holds.
 *   • `syncToPostgres()`      — write-behind after every mutation, so admin
 *     changes (create user, mint key, reset password, reset devices) survive a
 *     cold start.
 *
 * It talks to PostgREST over `fetch`, so it needs no database driver and adds
 * no dependency to the bundle. Every call is defensive: if Postgres is
 * unreachable or unconfigured the engine keeps running on its in-memory store
 * exactly as it did before.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
/** Prefer the service-role key: it bypasses RLS and is only ever read here. */
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

/** Postgres column names are camelCase and were created quoted. */
export const PG_TABLES = {
  users: 'User',
  licenses: 'LicenseKey',
  scannerConfigs: 'ScannerConfig',
  systemConfig: 'SystemConfig',
  coins: 'Coin',
  signals: 'ScannerSignal',
  riskItems: 'RiskWatchItem',
  auditLogs: 'AdminAuditLog',
} as const;

export function pgEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Reads rows from `table`. Returns null when Postgres is unusable. */
export async function pgSelect<T>(table: string, query = 'select=*'): Promise<T[] | null> {
  if (!pgEnabled()) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: headers(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T[];
  } catch {
    return null;
  }
}

/**
 * Upserts `rows` into `table`, matching on `onConflict`.
 * Empty input is a no-op so we never send a pointless round trip.
 */
export async function pgUpsert(table: string, rows: unknown[], onConflict: string): Promise<boolean> {
  if (!pgEnabled() || rows.length === 0) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Audit rows are append-only, so Postgres accumulates them without bound.
 * Snapshots already cap the in-memory copy at 500; this trims the table to the
 * same window.
 */
export async function pgPruneAuditLogs(keep = 500): Promise<void> {
  if (!pgEnabled()) return;
  try {
    const cutoff = await pgSelect<{ createdAt: number }>(
      PG_TABLES.auditLogs,
      `select=createdAt&order=createdAt.desc&limit=1&offset=${keep - 1}`,
    );
    const oldest = cutoff?.[0]?.createdAt;
    if (typeof oldest !== 'number') return;
    await fetch(`${SUPABASE_URL}/rest/v1/${PG_TABLES.auditLogs}?createdAt=lt.${oldest}`, {
      method: 'DELETE',
      headers: headers(),
      cache: 'no-store',
    });
  } catch {
    /* Pruning is best-effort — a full table is not a correctness problem. */
  }
}

/** Strips the singleton `id` column so a config row matches `SystemConfig`. */
export function toSystemConfigRow(row: Record<string, unknown> | null | undefined): SystemConfigShape {
  if (!row) return { ...DEFAULT_SYSTEM_CONFIG };
  const { id: _id, ...rest } = row;
  return { ...DEFAULT_SYSTEM_CONFIG, ...(rest as unknown as SystemConfigShape) };
}

type SystemConfigShape = typeof DEFAULT_SYSTEM_CONFIG;
