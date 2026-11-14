import { getDb } from '@/server/engine/db';

/**
 * §3  Awaits the Postgres mirror before a response is written.
 *
 * `persist()` schedules a debounced write-behind, which is fine on a
 * long-lived server but not on serverless: the process can be frozen the
 * moment the response is flushed, and the pending write would be lost.
 * Wrapping every mutating admin handler guarantees the upsert lands while the
 * request is still alive.
 *
 * Errors from the flush are swallowed so a database problem can never mask or
 * replace the handler's own result.
 */
export async function flushAfter<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } finally {
    try {
      await getDb().flushToPostgres();
    } catch {
      /* Durability is best-effort — never mask the handler's own failure. */
    }
  }
}
