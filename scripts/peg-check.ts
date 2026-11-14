import { buildUniverse } from '../server/engine/universe';
import { makeProfile, generateSeries } from '../server/engine/simulator';
const now = Date.now();
const pegs = ['FDUSD', 'USDC', 'PAXG', 'TUSD'];
const rows: string[] = [];
for (let i = 0; i < buildUniverse().length; i += 1) {
  const e = buildUniverse()[i];
  if (!pegs.includes(e.baseAsset)) continue;
  const c = generateSeries(makeProfile(e, i), 3_600_000, 520, now);
  const last = c[c.length - 1].c;
  const prev = c[c.length - 25].c;
  rows.push(`${e.symbol.padEnd(10)} price ${last.toFixed(5).padStart(11)}  24h ${(((last - prev) / prev) * 100).toFixed(2).padStart(7)}%`);
}
console.log(rows.join('\n') || 'no pegged assets in universe');
