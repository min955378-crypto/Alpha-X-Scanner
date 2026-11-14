/** Per-timeframe distribution probe: does each TF get a sane RSI spread + RVOL? */
import { buildUniverse } from '../server/engine/universe';
import { makeProfile, generateSeries } from '../server/engine/simulator';
import { rsiSeriesFromCloses } from '../server/engine/store';

const BAR_MS: Record<string, number> = { '15M': 9e5, '30M': 1.8e6, '1H': 3.6e6, '4H': 1.44e7, '1D': 8.64e7 };
const entries = buildUniverse();
const now = Date.now();
const mode = process.argv[2] ?? 'indep';

const rsis: Record<string, number[]> = { '15M': [], '30M': [], '1H': [], '4H': [], '1D': [] };
const rvols: Record<string, number[]> = { '15M': [], '30M': [], '1H': [], '4H': [], '1D': [] };

const volScaleFor = (tf: string) => Math.sqrt(BAR_MS[tf] / BAR_MS['1H']);

for (let i = 0; i < entries.length; i += 1) {
  const p = makeProfile(entries[i], i);
  const series: Record<string, ReturnType<typeof generateSeries>> = {};
  for (const tf of Object.keys(BAR_MS)) {
    const count = tf === '1H' ? 520 : tf === '15M' ? 240 : 260;
    series[tf] = generateSeries(p, BAR_MS[tf], count, now, 1, volScaleFor(tf));
    const c = series[tf];
    const closes = c.slice(0, -1).map((x) => x.c);
    const r = rsiSeriesFromCloses(closes);
    rsis[tf].push(r[r.length - 1]);
    const closedVols = c.slice(-21, -1).map((x) => x.v);
    const avg = closedVols.reduce((a, b) => a + b, 0) / closedVols.length;
    rvols[tf].push(avg > 0 ? c[c.length - 1].v / avg : 1);
  }
  if (i > 300) break; // sample is enough to characterise the distribution
}

const st = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return { sd: Math.sqrt(a.reduce((c, v) => c + (v - m) ** 2, 0) / a.length), mean: m, min: Math.min(...a), max: Math.max(...a) };
};
console.log(`mode=${mode}  n=${rsis['1H'].length}`);
for (const tf of Object.keys(BAR_MS)) {
  const r = st(rsis[tf]);
  const v = st(rvols[tf]);
  console.log(`${tf.padStart(4)}  RSI sd ${r.sd.toFixed(2).padStart(6)}  mean ${r.mean.toFixed(1)}  [${r.min.toFixed(0)}–${r.max.toFixed(0)}]   RVOL mean ${v.mean.toFixed(2)}`);
}
