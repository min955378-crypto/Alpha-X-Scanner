import { getEngine } from '../server/engine';
import { TF_SECONDS } from '../lib/types';

async function main() {
  const e = getEngine();
  await e.start();
  await new Promise((r) => setTimeout(r, 6000));
  const st = e.store.get('BTCUSDT')!;
  const tfs = st.tf['1H'];
  const forming = tfs.candles[tfs.candles.length - 1];
  const now = Date.now();
  const elapsed = (now - forming.t) / 1000;
  const avg = tfs.closedVols.reduce((a, b) => a + b, 0) / tfs.closedVols.length;
  console.log('hourlyQuoteVol', st.profile.hourlyQuoteVol);
  console.log('forming.v', forming.v, 'elapsed', elapsed.toFixed(0));
  console.log('closedVols avg', avg, 'len', tfs.closedVols.length);
  const denom = Math.max(elapsed, 60);
  console.log('vNorm', forming.v * (TF_SECONDS['1H'] / denom));
  console.log('rvol', (forming.v * (TF_SECONDS['1H'] / denom)) / avg);
  const s = e.store.snapshot(st, '1H', now, 999999);
  console.log('snapshot rvol', s.rvol);
  process.exit(0);
}
void main();
