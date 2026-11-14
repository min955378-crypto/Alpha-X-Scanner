/**
 * Offline calibration harness: generates the full universe and reports the
 * resulting RSI / 24h-change distribution so simulator constants can be tuned
 * without booting the server.
 */
import { buildUniverse } from '../server/engine/universe';
import { makeProfile, generateSeries, mulberry32, makeNormal } from '../server/engine/simulator';
import { rsiSeriesFromCloses } from '../server/engine/store';
import { ZONES } from '../lib/types';

const entries = buildUniverse();
const now = Date.now();

const rsis: number[] = [];
const changes: number[] = [];
const prices: number[] = [];

for (let i = 0; i < entries.length; i += 1) {
  const p = makeProfile(entries[i], i);
  const candles = generateSeries(p, 3_600_000, 520, now);
  const closed = candles.slice(0, -1);
  const closes = closed.map((c) => c.c);
  const series = rsiSeriesFromCloses(closes);
  rsis.push(series[series.length - 1]);

  const price = candles[candles.length - 1].c;
  const ref = candles[candles.length - 25].c;
  changes.push(((price - ref) / ref) * 100);
  prices.push(price);
}

const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((acc, v) => acc + (v - mean) ** 2, 0) / a.length);
  return { min: s[0], p1: s[Math.floor(s.length * 0.01)], p50: s[Math.floor(s.length * 0.5)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1], mean, sd };
};

const counts: Record<string, number> = {};
for (const z of ZONES) counts[z.id] = 0;
for (const r of rsis) {
  for (const z of ZONES) {
    const loOk = z.min === null || r >= z.min;
    const hiOk = z.max === null || r < z.max;
    if (loOk && hiOk) { counts[z.id] += 1; break; }
  }
}

console.log('universe', entries.length);
console.log('RSI   ', Object.fromEntries(Object.entries(stats(rsis)).map(([k, v]) => [k, +v.toFixed(2)])));
console.log('24h%  ', Object.fromEntries(Object.entries(stats(changes)).map(([k, v]) => [k, +v.toFixed(2)])));
console.log('zones ', counts);
console.log('price  min', Math.min(...prices).toPrecision(4), 'max', Math.max(...prices).toPrecision(6));
