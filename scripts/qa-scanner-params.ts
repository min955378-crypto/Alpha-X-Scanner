/**
 * MODULE 5 regression suite — proves the Admin Math Tuner is not a mock.
 *
 * 1. Factory parameters reproduce the historical signal geometry exactly.
 * 2. Tuning a threshold parameter changes engine output on the next scan.
 * 3. Tuning a structural parameter (EMA periods) changes the warm-up series.
 * 4. applyScannerConfig() hot-reloads without throwing and without data loss.
 */
import { getDb } from '../server/engine/db';
import { getEngine } from '../server/engine';
import { getScanParams, invalidateScanParams, FACTORY, requiredEmaPeriods } from '../server/engine/scanparams';
import { SCANNERS, type ScannerSlug } from '../lib/types';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log('\n[1] Factory parameter resolution');
  invalidateScanParams();
  for (const s of SCANNERS) {
    const p = getScanParams(s.slug);
    const f = FACTORY[s.slug];
    const same = Object.keys(f).every((k) => p[k] === f[k]);
    check(`${s.slug} resolves to factory defaults`, same);
  }
  check('EMA period set includes factory 9/13/21/34/50', [9, 13, 21, 34, 50].every((n) => requiredEmaPeriods().includes(n)));

  console.log('\n[2] Baseline scan (factory params)');
  const engine = getEngine();
  const t0 = Date.now();
  await engine.start();
  const slugs: ScannerSlug[] = SCANNERS.map((s) => s.slug);
  /* Wait for Phase A seeding (and Phase B if it lands quickly) so the scan
     has a real universe to work against. */
  for (let i = 0; i < 600 && !engine.boot.phaseAReady; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
  }
  check('engine Phase A completed', engine.boot.phaseAReady, `${engine.boot.seeded} coins`);
  console.log(`      booted in ${((Date.now() - t0) / 1000).toFixed(1)}s (mode=${engine.dataMode})`);
  /* The 60s cycle has not fired yet, so drive one explicit sweep to get a
     real factory baseline rather than an empty map. */
  engine.applyScannerConfig();
  const baseline = slugs.map((slug) => ({ slug, count: engine.getSignals(slug).length }));
  console.log('      baseline:', baseline.map((b) => `${b.slug}=${b.count}`).join(' '));
  check('factory baseline produced signals', baseline.some((b) => b.count > 0), baseline.map((b) => b.count).join('/'));

  console.log('\n[3] Tuning a threshold changes engine output');
  const db = getDb();
  const v1 = db.scannerConfigs.get('v1-scaling');
  if (!v1) throw new Error('v1-scaling config missing');
  /* A tuned risk/reward geometry must move the published price levels, not
     just the internal state. Widen TP1 from 1.8×ATR to 9.5×ATR and confirm the
     RR of the published signals grows by the expected ratio. */
  const rrBefore = engine.getSignals('v1-scaling').map((g) => g.rrRatio).filter((r) => r > 0);
  v1.parametersJson = { ...FACTORY['v1-scaling'], atrTp1Mult: 9.5 };
  v1.updatedAt = Date.now() + 1;
  invalidateScanParams();
  const tuned = getScanParams('v1-scaling');
  check('tuned atrTp1Mult is honoured', tuned.atrTp1Mult === 9.5, `got ${tuned.atrTp1Mult}`);
  const res = engine.applyScannerConfig();
  check('hot-reload rewarmed symbols', res.rewarmed > 0, `${res.rewarmed} tf states`);
  check('hot-reload rescanned v1', res.rescanned.includes('v1-scaling'));
  const rrAfter = engine.getSignals('v1-scaling').map((g) => g.rrRatio).filter((r) => r > 0);
  const rrAvg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  check(
    'tuned TP1 multiplier widens the published R:R',
    rrAvg(rrAfter) > rrAvg(rrBefore) * 3,
    `before=${rrAvg(rrBefore).toFixed(2)} after=${rrAvg(rrAfter).toFixed(2)}`,
  );

  /* An RVOL floor of 50× is syntactically valid but no coin prints it, so the
     confirmation gate must remove every ENTRY_READY from V1. */
  v1.parametersJson = { ...FACTORY['v1-scaling'], rvolMin: 50 };
  v1.updatedAt = Date.now() + 2;
  invalidateScanParams();
  engine.applyScannerConfig();
  const entryReady = engine.getSignals('v1-scaling').filter((g) => g.stage === 'ENTRY_READY').length;
  check('50× RVOL floor removes every V1 ENTRY_READY', entryReady === 0, `entryReady=${entryReady}`);

  console.log('\n[4] Clamping protects the engine from bad input');
  const v1b = db.scannerConfigs.get('v1-scaling')!;
  v1b.parametersJson = { ...FACTORY['v1-scaling'], rsiMin: -50, atrSlMult: 0, rvolMin: 1e9 };
  v1b.updatedAt = Date.now() + 5;
  invalidateScanParams();
  const clamped = getScanParams('v1-scaling');
  check('negative RSI clamped into [1,99]', clamped.rsiMin >= 1, `got ${clamped.rsiMin}`);
  check('zero ATR multiplier clamped to >= 0.1', clamped.atrSlMult >= 0.1, `got ${clamped.atrSlMult}`);
  check('absurd RVOL clamped to <= 50', clamped.rvolMin <= 50, `got ${clamped.rvolMin}`);
  check('no NaN produced', Object.values(clamped).every((v) => Number.isFinite(v)));

  console.log('\n[5] Structural parameter rebuilds the series');
  const emaCfg = db.scannerConfigs.get('ema-crossover')!;
  emaCfg.parametersJson = { ...emaCfg.parametersJson, fastEma: 5, midEma: 13, slowEma: 34 };
  emaCfg.updatedAt = Date.now() + 3;
  invalidateScanParams();
  check('requiredEmaPeriods picks up tuned periods', [5, 13, 34].every((n) => requiredEmaPeriods().includes(n)), requiredEmaPeriods().join(','));
  const res2 = engine.applyScannerConfig();
  check('structural hot-reload succeeded', res2.rewarmed > 0 && res2.rescanned.includes('ema-crossover'));

  console.log('\n[6] Restore factory defaults');
  for (const s of SCANNERS) {
    const cfg = db.scannerConfigs.get(s.slug)!;
    cfg.parametersJson = { ...FACTORY[s.slug] };
    cfg.updatedAt = Date.now() + 10;
  }
  invalidateScanParams();
  engine.applyScannerConfig();
  const restored = slugs.map((slug) => engine.getSignals(slug).length);
  console.log('      restored:', restored.map((c, i) => `${slugs[i]}=${c}`).join(' '));
  const same = restored.every((c, i) => c === baseline[i].count);
  check('factory geometry restored exactly', same, `expected ${baseline.map((b) => b.count).join('/')}, got ${restored.join('/')}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
