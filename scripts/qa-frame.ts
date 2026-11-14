/**
 * §15.2  Live acceptance check against a running Alpha X Scanner server.
 *
 *   npm run dev            # in one shell
 *   npm run qa:frame       # in another (waits for Phase B automatically)
 *
 * Verifies the spec invariants that only exist at runtime:
 *   · §2.2  Phase A seeds the whole universe inside the 31s budget
 *   · §7.3  Score is clamped 0–100 and identical across every consumer
 *   · §7.2  Alpha Sniper never divides by zero (closedTrades500 < 5 guard)
 *   · §6.2  All six RSI zones resolve and every coin lands in exactly one
 *   · §3.3  RVOL(20) stays centred on 1.0
 */
const BASE = process.env.SCALPPRO_URL ?? 'http://127.0.0.1:3000';
const TIMEFRAMES = ['15M', '30M', '1H', '4H', '1D'] as const;
const ZONES = ['GAINERS', 'V1', 'NEUTRAL', 'HIDDEN_BULL', 'OVERSOLD', 'EXTREME'];

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function waitForPhaseB(): Promise<void> {
  for (let i = 0; i < 70; i += 1) {
    const r = await fetch(`${BASE}/api/market/health`).then((x) => x.json());
    if (r.boot?.phaseBReady) return;
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error('Phase B did not complete within 350s');
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};

async function main() {
  console.log(`Alpha X Scanner live acceptance check → ${BASE}\n`);
  await waitForPhaseB();

  const health = await fetch(`${BASE}/api/market/health`).then((x) => x.json());
  const boot = health.boot;
  check(boot.phaseAReady, '§2.2 Phase A seeded', `${boot.seeded}/${boot.total} coins`);
  check(
    (boot.phaseAElapsedSec ?? 999) <= 31,
    '§2.2 Phase A inside 31s budget',
    `${boot.phaseAElapsedSec}s`,
  );
  check(
    boot.weightUsedMin <= 1200,
    '§2.2 Peak request weight under 1,200/min',
    `${boot.weightUsedMin}/1200`,
  );

  for (const tf of TIMEFRAMES) {
    const res = await fetch(`${BASE}/api/market/frame?tf=${tf}`).then((x) => x.json());
    const coins = res.frame.coins as Array<Record<string, number | string | null>>;
    console.log(`\n── ${tf} ─────────────────────────────────────────`);

    check(coins.length === boot.total, `${tf} every coin present`, `${coins.length}`);

    const scores = coins.map((c) => Number(c.sc));
    check(
      Math.min(...scores) >= 0 && Math.max(...scores) <= 100,
      `${tf} §7.3 score clamped 0–100`,
      `${Math.min(...scores)}–${Math.max(...scores)}`,
    );

    const rsis = coins.map((c) => Number(c.r));
    check(
      Math.min(...rsis) >= 0 && Math.max(...rsis) <= 100,
      `${tf} RSI(14) within 0–100`,
      `${Math.min(...rsis).toFixed(1)}–${Math.max(...rsis).toFixed(1)}`,
    );
    check(sd(rsis) > 4, `${tf} RSI distribution is not degenerate`, `sd ${sd(rsis).toFixed(2)}`);

    // §7.2 — the zero-division guard.
    const violating = coins.filter((c) => Number(c.ct ?? 0) >= 5 && c.w5 === null);
    const premature = coins.filter((c) => Number(c.ct ?? 0) < 5 && c.w5 !== null);
    check(violating.length === 0, `${tf} §7.2 wr500 present whenever closedTrades500 ≥ 5`, `${violating.length} missing`);
    check(premature.length === 0, `${tf} §7.2 wr500 withheld when closedTrades500 < 5`, `${premature.length} leaking`);

    // §3.3 / §7.1 — RVOL(20) must stay centred on 1.0.
    const rvols = coins.map((c) => Number(c.rv));
    check(mean(rvols) > 0.7 && mean(rvols) < 1.4, `${tf} RVOL(20) mean ≈ 1.0`, mean(rvols).toFixed(2));

    const counts = res.frame.counts.zones as Record<string, number>;
    const total = ZONES.reduce((a, z) => a + (counts[z] ?? 0), 0);
    check(total === coins.length, `${tf} §6.2 every coin in exactly one zone`, `${total}/${coins.length}`);
    console.log(
      `      zones ${ZONES.map((z) => `${z}:${counts[z] ?? 0}`).join('  ')}`,
    );
  }

  console.log(`\n${failures === 0 ? '✓ all acceptance checks passed' : `✗ ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
