import { buildUniverse } from '../server/engine/universe';
import { makeProfile, generateSeries } from '../server/engine/simulator';
import { rsiSeriesFromCloses } from '../server/engine/store';
import { ZONES } from '../lib/types';

const entries = buildUniverse();
const now = Date.now();
const rsis: number[] = [];
const changes: number[] = [];
for (let i = 0; i < entries.length; i += 1) {
  const p = makeProfile(entries[i], i);
  const candles = generateSeries(p, 3_600_000, 520, now);
  const closes = candles.slice(0, -1).map((c) => c.c);
  const series = rsiSeriesFromCloses(closes);
  rsis.push(series[series.length - 1]);
  changes.push(((candles[candles.length - 1].c - candles[candles.length - 25].c) / candles[candles.length - 25].c) * 100);
}
const st = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return [s[0], s[(s.length * 0.01) | 0], s[(s.length * 0.5) | 0], s[(s.length * 0.99) | 0], s[s.length - 1], m, Math.sqrt(a.reduce((c, v) => c + (v - m) ** 2, 0) / a.length)];
};
const counts: Record<string, number> = {};
for (const z of ZONES) counts[z.id] = 0;
for (const r of rsis) for (const z of ZONES) if ((z.min === null || r >= z.min) && (z.max === null || r < z.max)) { counts[z.id] += 1; break; }
const f = (a: number[]) => a.map((v) => v.toFixed(1)).join(' ');
console.log(`MR=${process.env.SIM_MR} TP=${process.env.SIM_TP} TI=${process.env.SIM_TI} | RSI[min p1 p50 p99 max mean sd] ${f(st(rsis))} | 24h[min p1 p50 p99 max mean sd] ${f(st(changes))} | ${JSON.stringify(counts)}`);
