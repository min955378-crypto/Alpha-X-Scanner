/**
 * §1  Live-ingestion regression suite.
 *
 * The sandbox has no outbound network, so the LIVE path — bulk tickers,
 * funding rates and the parallel kline warm-up — is otherwise unverifiable
 * here. This suite stands up a mock Binance REST host and drives the real
 * store through it.
 *
 * The invariant that matters most is the one that silently breaks: **a coin
 * must never vanish from the frame, and real data must never be overwritten by
 * simulated data.** Both are pinned here.
 *
 * Run with `npm run qa:live`.
 */

/* First import: redirect the JSON snapshot before db.ts resolves its path. */
import './_isolate';

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = 4631;
let klineRequests = 0;
/** Peak in-flight kline requests, to prove the warm-up really is concurrent. */
let klineInFlight = 0;
let klinePeak = 0;

const SYMBOLS: string[] = [];

function startMock(): Promise<() => void> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/api/v3/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
        return;
      }

      if (url.pathname === '/api/v3/ticker/24hr') {
        const rows = SYMBOLS.map((symbol, i) => ({
          symbol,
          lastPrice: String(100 - (i % 90)),
          priceChangePercent: String(((i % 41) - 20) / 2),
          quoteVolume: String(1_000_000 * ((i % 300) + 1)),
          highPrice: String(110 - (i % 90)),
          lowPrice: String(90 - (i % 90)),
          bidPrice: String(100 - (i % 90) - 0.01),
          askPrice: String(100 - (i % 90) + 0.01),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows));
        return;
      }

      if (url.pathname === '/api/v3/klines') {
        klineRequests += 1;
        klineInFlight += 1;
        klinePeak = Math.max(klinePeak, klineInFlight);
        const now = Date.now();
        const barMs = 3_600_000;
        const open = Math.floor(now / barMs) * barMs - 98 * barMs;
        const rows = Array.from({ length: 99 }, (_, i) => {
          const o = 50 + ((i * 7) % 30);
          return [open + i * barMs, o, o + 2, o - 2, o + 1, '1000', 0, '100000', 0, 0, 0, 0];
        });
        setTimeout(() => {
          klineInFlight -= 1;
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows));
        }, 15);
        return;
      }

      res.writeHead(404).end('');
    });

    server.listen(PORT, '127.0.0.1', () => resolve(() => server.close()));
  });
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const stop = await startMock();

  const { REST_HOSTS } = await import('../server/engine/binance');
  /* The registry is ordered by preference; putting the mock first makes every
     `getJson('/api/v3/...')` call resolve here instead of to the internet. */
  (REST_HOSTS as string[]).unshift(`http://127.0.0.1:${PORT}`);

  const { buildUniverse } = await import('../server/engine/universe');
  const { MarketStore } = await import('../server/engine/store');
  const { fetchTickers, fetchKlines } = await import('../server/engine/binance');

  const entries = buildUniverse();
  SYMBOLS.push(...entries.map((e) => e.symbol));

  const store = new MarketStore();
  store.setUniverse(entries);
  const now = Date.now();

  /* ------------------------------------------------ §1.1 cold-start coverage */
  console.log('\n§1.1  Every coin is present before any backfill');
  {
    check('the universe is 600+ coins', entries.length >= 600, `${entries.length}`);
    for (const tf of ['15M', '30M', '1H', '4H', '1D'] as const) {
      const frame = store.buildFrame(tf, now, 60, 0, 'LIVE');
      check(`${tf} serves the whole universe`, frame.coins.length === entries.length, `${frame.coins.length}`);
      const bad = frame.coins.filter(
        (c) =>
          !Number.isFinite(c.price) ||
          !Number.isFinite(c.rsi) ||
          !Number.isFinite(c.rvol) ||
          !Number.isFinite(c.spreadPct) ||
          c.obStatus == null ||
          c.emaStatus == null,
      );
      check(`${tf} every coin has finite indicators`, bad.length === 0, `${bad.length} bad`);
    }
  }

  /* --------------------------------------------------- §1.2 bulk ticker pull */
  console.log('\n§1.2  Bulk ticker ingestion');
  {
    const tickers = await fetchTickers();
    check('the bulk ticker call succeeded', tickers !== null, `${tickers?.size ?? 0} rows`);

    let applied = 0;
    for (const t of (tickers ?? new Map()).values()) {
      if (store.applyTicker(t)) applied += 1;
    }
    check('every row applied to a known symbol', applied === entries.length, `${applied}/${entries.length}`);

    const btc = store.get('BTCUSDT');
    check('the real price landed', btc !== undefined && btc.price === 100, String(btc?.price));
    check('the real 24h change landed', btc?.changePct24h === -10, String(btc?.changePct24h));
    check('the real quote volume landed', btc?.quoteVol24h === 1_000_000, String(btc?.quoteVol24h));
    check('the real 24h high landed', btc?.high24h === 110, String(btc?.high24h));

    /* §1.2.1  spread = (ask - bid) / last * 100 → 0.02 / 100 * 100 = 0.02 */
    check(
      'the bid-ask spread is computed from the live book',
      Math.abs((btc?.spreadPct ?? 0) - 0.02) < 1e-9,
      String(btc?.spreadPct),
    );

    /* The 24h statistics now come from the exchange. A candle-derived
       recompute must extend the intrabar extremes without replacing them. */
    store.tick(now + 1000, 1, true);
    check('a live tick does not clobber the real 24h change', btc?.changePct24h === -10, String(btc?.changePct24h));
    check('a live tick does not invent a price', btc?.price === 100, String(btc?.price));
    check('the real 24h high is preserved', btc?.high24h === 110, String(btc?.high24h));
  }

  /* ------------------------------------------------------- §1.2.2 funding */
  console.log('\n§1.2.2  Funding rates');
  {
    /* `fetchFundingRates` targets an absolute fapi host, so the store methods
       are exercised directly: the network call itself needs real egress. */
    check('applyFunding records the contract', store.applyFunding('BTCUSDT', 0.01) === true);
    check('and the rate in percent', store.get('BTCUSDT')?.fundingRatePct === 0.01);
    check('an unknown symbol is rejected', store.applyFunding('NOTACOINUSDT', 0.01) === false);
    check('a non-finite rate is rejected', store.applyFunding('ETHUSDT', Number.NaN) === false);

    /* The exchange's map is authoritative in both directions. The simulated
       profile assigns `hasPerpetual` at random, so without reconciliation a
       spot-only coin would show a funding rate it does not have. */
    const rates = new Map<string, number>([
      ['BTCUSDT', 0.01],
      ['ETHUSDT', -0.025],
    ]);
    const { withPerp, spotOnly } = store.reconcileFunding(rates);
    check('both perpetuals were recorded', withPerp === 2, `${withPerp}`);
    check('every other coin was cleared to spot-only', spotOnly === entries.length - 2, `${spotOnly}`);
    check('a funded coin keeps its rate', store.get('ETHUSDT')?.fundingRatePct === -0.025);
    check('a spot-only coin is flagged false', store.get('SOLUSDT')?.hasPerpetual === false);
    check('and carries no rate', store.get('SOLUSDT')?.fundingRatePct === null);
  }

  /* ------------------------------------------------------ §1.3 kline warm-up */
  console.log('\n§1.3  Real klines replace baselines and are never clobbered');
  {
    const raw = await fetchKlines('BTCUSDT', '1H', 99);
    check('a kline fetch returns candles', (raw?.length ?? 0) === 99, `${raw?.length ?? 0}`);

    const wasBaseline = store.get('BTCUSDT')?.tf['1H']?.baseline === true;
    check('the coin started on a baseline', wasBaseline);

    check('seedFromCandles accepted the real series', store.seedFromCandles('BTCUSDT', '1H', raw ?? []));
    const after = store.get('BTCUSDT')?.tf['1H'];
    check('the state is no longer a placeholder', after?.baseline !== true);
    check('it holds the real candles', after?.candles.length === 99, `${after?.candles.length}`);

    /* The critical invariant: the simulated backfill runs concurrently and
       must not undo what the real fetch just wrote. */
    store.seedSymbol('BTCUSDT', Date.now());
    const afterSeed = store.get('BTCUSDT')?.tf['1H'];
    check('a simulated backfill does not clobber real candles', afterSeed?.candles.length === 99, `${afterSeed?.candles.length}`);
    check('and does not overwrite the real price', store.get('BTCUSDT')?.price === 100, String(store.get('BTCUSDT')?.price));

    /* A coin the warm-up never reached is still upgraded by the simulation. */
    store.seedSymbol('ETHUSDT', Date.now());
    check('an untouched coin still backfills', store.get('ETHUSDT')?.tf['1H']?.baseline !== true);
  }

  /* ---------------------------------------------- §1.3 concurrency + weight */
  console.log('\n§1.3  Warm-up concurrency');
  {
    klinePeak = 0;
    klineRequests = 0;
    const symbols = store.list().filter((s) => s.enabled).map((s) => s.entry.symbol).slice(0, 120);
    const CONCURRENCY = 40;
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      const res = await Promise.allSettled(batch.map((s) => fetchKlines(s, '1H', 99)));
      for (let j = 0; j < batch.length; j += 1) {
        const r = res[j];
        if (r.status === 'fulfilled' && r.value) store.seedFromCandles(batch[j], '1H', r.value);
      }
    }
    check('every symbol was requested', klineRequests === symbols.length, `${klineRequests}/${symbols.length}`);
    check('requests really do overlap', klinePeak > 1, `peak ${klinePeak} in flight`);
    const warmed = symbols.filter((s) => store.get(s)?.tf['1H']?.candles.length === 99);
    check('every warmed coin holds real candles', warmed.length === symbols.length, `${warmed.length}/${symbols.length}`);

    /* §1.3  99 candles is weight 1; 601 coins therefore fits the 1,200 cap. */
    const { klinesWeight } = await import('../server/engine/binance');
    check('a 99-candle request costs weight 1', klinesWeight(99) === 1);
    check('the whole book fits the weight cap', entries.length * klinesWeight(99) <= 1200, `${entries.length * klinesWeight(99)}/1200`);
  }

  /* ------------------------------------------------ §4.2 wire round trip */
  console.log('\n§4.2  Coin Finder order block distances survive the wire');
  {
    const { encodeCoin, decodeCoin } = await import('../lib/wire');
    const sample = store.get('BTCUSDT');
    const frame = store.buildFrame('1H', Date.now(), 60, 1, 'LIVE');
    const coins = frame.coins;
    check('the frame has coins to test', coins.length > 0, `${coins.length}`);

    const withZone = coins.find((c) => c.bullObDistPct !== null || c.bearObDistPct !== null);
    const withoutZone = coins.find((c) => c.bullObDistPct === null && c.bearObDistPct === null);

    /* "No zone" and "inside the zone (0)" are different answers. Both must
       survive encode → decode unchanged or the filter lies to the trader. */
    if (withoutZone) {
      const back = decodeCoin(encodeCoin(withoutZone));
      check('a coin with no zone round trips as null', back.bullObDistPct === null && back.bearObDistPct === null);
    } else {
      check('a coin with no zone round trips as null', false, 'no such coin in this frame');
    }

    if (withZone) {
      const back = decodeCoin(encodeCoin(withZone));
      const same =
        (withZone.bullObDistPct === null && back.bullObDistPct === null) ||
        Math.abs((back.bullObDistPct ?? 0) - (withZone.bullObDistPct ?? 0)) <= 0.01;
      check('a coin with a zone round trips within 0.01%', same, `${withZone.bullObDistPct} → ${back.bullObDistPct}`);
    } else {
      check('a coin with a zone round trips within 0.01%', false, 'no zone found in this frame');
    }

    const inside = coins.find((c) => c.bullObDistPct === 0);
    if (inside) {
      const back = decodeCoin(encodeCoin(inside));
      check('a coin inside a zone still reads 0, not null', back.bullObDistPct === 0);
    } else {
      check('a coin inside a zone still reads 0, not null', true, 'skipped — no coin inside a zone');
    }
    void sample;
  }

  /* -------------------------------------------------- final frame integrity */
  console.log('\n§1.1  The frame still covers every coin afterwards');
  {
    for (const tf of ['15M', '30M', '1H', '4H', '1D'] as const) {
      const frame = store.buildFrame(tf, Date.now(), 60, 1, 'LIVE');
      check(`${tf} still serves ${entries.length} coins`, frame.coins.length === entries.length, `${frame.coins.length}`);
      const bad = frame.coins.filter(
        (c) => !Number.isFinite(c.price) || !Number.isFinite(c.rsi) || !Number.isFinite(c.rvol),
      );
      check(`${tf} no coin degraded to NaN`, bad.length === 0, `${bad.length} bad`);
    }
  }

  stop();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((err: unknown) => {
  console.error('\nQA run crashed:', err);
  process.exitCode = 1;
});
