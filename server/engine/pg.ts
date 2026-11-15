import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';
import type { SystemConfig } from '@/lib/types';

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
 * How many unknown-column retries `pgUpsert` will attempt.
 *
 * One retry per offending column, so this is effectively "how many unmigrated
 * optional columns can one table have before we stop trying". Raised to 15
 * because the cost of being wrong is severe and asymmetric: a too-low cap
 * silently abandons the write, so a customer created in `/admin` never reaches
 * Postgres and cannot log in. Each retry only happens on a 400, and only for
 * tables that are actually missing columns — a healthy table still issues
 * exactly one request.
 */
const MAX_UPSERT_RETRIES = 15;

/**
 * §8.4  Pulls the offending column out of a PostgREST "unknown column" error.
 *
 * PostgREST answers with a body like:
 *   {"code":"PGRST204","message":"Could not find the 'totpSecret' column of
 *    'User' in the schema cache"}
 *
 * We return only the column name so the caller can drop that one key and
 * retry — the rest of the row still persists.
 */
function unknownColumnFrom(body: string): string | null {
  const quoted = /Could not find the '([^']+)' column/.exec(body);
  if (quoted?.[1]) return quoted[1];
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    if (parsed.code !== 'PGRST204') return null;
    return /'([^']+)'/.exec(parsed.message ?? '')?.[1] ?? null;
  } catch {
    return null;
  }
}

function stripKey(rows: unknown[], key: string): unknown[] {
  return rows.map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return r;
    const { [key]: _dropped, ...rest } = r as Record<string, unknown>;
    return rest;
  });
}

/**
 * Upserts `rows` into `table`, matching on `onConflict`.
 *
 * Empty input is a no-op so we never send a pointless round trip.
 *
 * §8.4  Schema-tolerant: if PostgREST rejects the payload because a column has
 * not been migrated yet (HTTP 400 / `PGRST204`), we drop just that column and
 * retry. Without this, adding one field to a row type would silently stop *all*
 * persistence for that table — every user write would fail, and nothing would
 * look broken until the next cold start revealed the data was never saved.
 */
export async function pgUpsert(table: string, rows: unknown[], onConflict: string): Promise<boolean> {
  if (!pgEnabled() || rows.length === 0) return false;

  let payload = rows;

  for (let attempt = 0; attempt <= MAX_UPSERT_RETRIES; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
    } catch {
      return false;
    }

    if (res.ok) return true;

    const body = await res.text().catch(() => '');
    if (res.status !== 400) return false;

    const column = unknownColumnFrom(body);
    if (!column) return false;

    /* Never strip the conflict target. An upsert with no `on_conflict` column
       cannot match a row, so "succeeding" would mean the write silently did
       nothing — and a missing primary key means the table is in a far worse
       state than one unmigrated optional column, so failing loudly is right. */
    if (column === onConflict) return false;

    const next = stripKey(payload, column);
    /* Nothing left to strip — the payload is empty or the column was absent,
       so retrying would spin. */
    if (JSON.stringify(next) === JSON.stringify(payload)) return false;
    payload = next;
  }

  return false;
}

/**
 * §3.1  Deletes rows matching `column = value`.
 *
 * `flushToPostgres()` only ever upserts, so a deleted user or a deleted license
 * key was still present in Postgres and reappeared on the next cold start when
 * `hydrateFromPostgres()` ran. Deletions therefore have to be replayed
 * explicitly.
 *
 * Returns false when Postgres is unusable or the request fails, so callers can
 * carry on — a failed delete is the same durability degradation a failed
 * upsert is, not a reason to break the request.
 */
export async function pgDeleteById(table: string, column: string, value: string): Promise<boolean> {
  if (!pgEnabled()) return false;
  if (!value) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}`,
      {
        method: 'DELETE',
        headers: headers({ Prefer: 'return=minimal' }),
        cache: 'no-store',
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Strips the singleton `id` column so a config row matches `SystemConfig`. */
export function toSystemConfigRow(row: Record<string, unknown> | null | undefined): SystemConfig {
  if (!row) return { ...DEFAULT_SYSTEM_CONFIG };
  const { id: _id, ...rest } = row;
  return { ...DEFAULT_SYSTEM_CONFIG, ...(rest as unknown as SystemConfig) };
}
