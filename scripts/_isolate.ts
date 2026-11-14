/**
 * Redirects the on-disk JSON snapshot to a throwaway directory.
 *
 * `server/engine/db.ts` resolves its data file from `AX_DATA_DIR` at module
 * load, and ES module imports are evaluated in declaration order — so a script
 * that imports this file *first* gets an isolated store, while a script that
 * omits it keeps using the real `.data/` snapshot.
 *
 * Only import this from QA scripts; the server must never set it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ax-qa-'));

process.env.AX_DATA_DIR = dir;

for (const sig of ['exit', 'SIGINT', 'SIGTERM', 'uncaughtException'] as const) {
  process.once(sig, () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dir cleanup is best-effort */
    }
  });
}
