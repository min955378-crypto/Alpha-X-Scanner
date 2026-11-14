/**
 * §4.1–4.3  Data-plane failover regression suite.
 *
 * The sandbox this was authored in has no route to Binance, Bybit or CoinCap,
 * so the live path cannot be exercised end-to-end here. This suite proves the
 * *logic* instead by stubbing global fetch and asserting:
 *
 *   1. `data-api.binance.vision` is tried BEFORE `api.binance.com`.
 *   2. A 451 on the primary promotes the mirror, and the failed host is not
 *      retried inside its backoff window.
 *   3. When every Binance host fails, we fall through to Bybit V5.
 *   4. When Bybit fails too, we fall through to CoinCap.
 *   5. `probe()` returns true if (and only if) some upstream answers.
 *   6. Ticker normalisation is correct — notably Bybit's ratio→percent
 *      conversion, which is the easiest thing to get silently wrong.
 *
 *   npx tsx scripts/qa-providers.ts
 */

export {};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Call {
  url: string;
}

const calls: Call[] = [];

/** Route map: predicate → JSON body, or `null` to simulate an HTTP failure. */
type Router = Array<{ match: RegExp; status: number; body: unknown }>;

function installFetch(router: Router): void {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(typeof input === 'object' && 'url' in input ? (input as Request).url : input);
    calls.push({ url });
    for (const r of router) {
      if (r.match.test(url)) {
        if (r.status !== 200) {
          return { ok: false, status: r.status, json: async () => ({}) } as Response;
        }
        return { ok: true, status: 200, json: async () => r.body } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;
}

const EXCHANGE_INFO = {
  symbols: [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true },
    // Leveraged tokens must be stripped (§4.1).
    { symbol: 'BTCUPUSDT', baseAsset: 'BTCUP', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true },
    { symbol: 'ETHBEARUSDT', baseAsset: 'ETHBEAR', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true },
    // Non-USDT quote must be stripped.
    { symbol: 'ETHBTC', baseAsset: 'ETH', quoteAsset: 'BTC', status: 'TRADING', isSpotTradingAllowed: true },
    // Broken pairs must be stripped.
    { symbol: 'DEADUSDT', baseAsset: 'DEAD', quoteAsset: 'USDT', status: 'BREAK', isSpotTradingAllowed: true },
  ],
};

const BINANCE_TICKERS = [
  { symbol: 'BTCUSDT', lastPrice: '100.5', priceChangePercent: '2.5', quoteVolume: '1000', highPrice: '101', lowPrice: '99', bidPrice: '100.4', askPrice: '100.6' },
  { symbol: 'ETHUSDT', lastPrice: '10.5', priceChangePercent: '-1.5', quoteVolume: '500', highPrice: '11', lowPrice: '10', bidPrice: '10.4', askPrice: '10.6' },
];

const BYBIT_TICKERS = {
  result: {
    list: [
      { symbol: 'BTCUSDT', lastPrice: '100.5', price24hPcnt: '0.025', turnover24h: '1000', highPrice24h: '101', lowPrice24h: '99', bid1Price: '100.4', ask1Price: '100.6' },
    ],
  },
};

const COINCAP = {
  data: [
    { symbol: 'BTC', priceUsd: '100.5', changePercent24Hr: '2.5', volumeUsd24Hr: '1000' },
  ],
};

async function main(): Promise<void> {
  const binance = await import('../server/engine/binance');

  console.log('\nData-plane failover regression suite\n');

  /* 1 — primary host preference ------------------------------------------- */
  installFetch([{ match: /^https:\/\/data-api\.binance\.vision\/api\/v3\/exchangeInfo/, status: 200, body: EXCHANGE_INFO }]);
  const uni = await binance.fetchUniverse(new Set(['BTC']));
  check(
    '§4.1 data-api.binance.vision is the PRIMARY REST host',
    calls[0]?.url.startsWith('https://data-api.binance.vision') === true,
    calls[0]?.url,
  );
  check('§4.1 universe parsed', uni?.length === 2, `got ${uni?.length}`);
  check(
    '§4.1 leveraged tokens + non-USDT quotes stripped',
    uni?.every((u) => !/UP$|DOWN$|BULL$|BEAR$/.test(u.baseAsset)) === true,
    JSON.stringify(uni),
  );
  check('§4.1 monitoring tag detected', uni?.find((u) => u.baseAsset === 'BTC')?.isMonitoringTag === true);

  /* 2 — 451 on the primary promotes the mirror ---------------------------- */
  binance.resetHostState();
  installFetch([
    { match: /^https:\/\/data-api\.binance\.vision\//, status: 451, body: {} },
    { match: /^https:\/\/api\.binance\.com\/api\/v3\/exchangeInfo/, status: 200, body: EXCHANGE_INFO },
  ]);
  calls.length = 0;
  const uni2 = await binance.fetchUniverse(new Set());
  check(
    '§4.1 HTTP 451 on the primary fails over to api.binance.com',
    calls.some((c) => c.url.startsWith('https://api.binance.com')) && uni2?.length === 2,
    JSON.stringify(calls.map((c) => c.url)),
  );

  /* The down host must NOT be retried inside its backoff window. */
  calls.length = 0;
  await binance.fetchUniverse(new Set());
  check(
    '§4.1 the blocked host is skipped on the next call (backoff)',
    calls.every((c) => !c.url.startsWith('https://data-api.binance.vision')),
    JSON.stringify(calls.map((c) => c.url)),
  );

  /* 3 — Bybit fallback ---------------------------------------------------- */
  /* Reset backoff by loading a fresh module instance. */
  binance.resetHostState();
  installFetch([
    { match: /binance/, status: 451, body: {} },
    { match: /^https:\/\/api\.bybit\.com\/v5\/market\/tickers/, status: 200, body: BYBIT_TICKERS },
  ]);
  calls.length = 0;
  const t3 = await binance.fetchTickers();
  check(
    '§4.3 all-Binance-down falls back to Bybit V5',
    calls.some((c) => c.url.includes('api.bybit.com')) && t3?.has('BTCUSDT') === true,
    JSON.stringify(calls.map((c) => c.url)),
  );
  check(
    '§4.3 Bybit ratio→percent conversion (0.025 → 2.5%)',
    Math.abs((t3?.get('BTCUSDT')?.priceChangePercent ?? 0) - 2.5) < 1e-9,
    String(t3?.get('BTCUSDT')?.priceChangePercent),
  );

  /* 4 — CoinCap fallback -------------------------------------------------- */
  binance.resetHostState();
  installFetch([
    { match: /binance/, status: 451, body: {} },
    { match: /bybit/, status: 500, body: {} },
    { match: /^https:\/\/api\.coincap\.io\/v2\/assets/, status: 200, body: COINCAP },
  ]);
  calls.length = 0;
  const t4 = await binance.fetchTickers();
  check(
    '§4.3 Bybit-down falls back to CoinCap',
    calls.some((c) => c.url.includes('api.coincap.io')) && t4?.has('BTCUSDT') === true,
    JSON.stringify(calls.map((c) => c.url)),
  );
  check('§4.3 CoinCap price mapped', t4?.get('BTCUSDT')?.lastPrice === 100.5);

  /* 5 — probe() ----------------------------------------------------------- */
  binance.resetHostState();
  installFetch([{ match: /./, status: 500, body: {} }]);
  check('§4.3 probe() false when every upstream is dead', (await binance.probe()) === false);

  binance.resetHostState();
  installFetch([{ match: /^https:\/\/data-api\.binance\.vision\/api\/v3\/ping/, status: 200, body: {} }]);
  const probe5 = await binance.probe();
  check('§4.1 probe() true when the primary answers', probe5 === true, `probe=${probe5}`);

  /* 6 — Binance ticker normalisation -------------------------------------- */
  binance.resetHostState();
  installFetch([{ match: /ticker\/24hr/, status: 200, body: BINANCE_TICKERS }]);
  const t6 = await binance.fetchTickers();
  check('§4.1 bid/ask spread captured', t6?.get('BTCUSDT')?.bidPrice === 100.4 && t6?.get('BTCUSDT')?.askPrice === 100.6);
  check('§4.1 24h high/low captured', t6?.get('ETHUSDT')?.highPrice === 11 && t6?.get('ETHUSDT')?.lowPrice === 10);

  /* 7 — klines weight metering -------------------------------------------- */
  /* Phase A deliberately requests limit=99 (weight 1) rather than the spec's
     limit=100 (weight 2) so 20 req/s stays inside the 1,200/min budget. */
  check('§2.2 klines weight: limit=99 (Phase A) → 1', binance.klinesWeight(99) === 1);
  check('§2.2 klines weight: limit=100 → 2', binance.klinesWeight(100) === 2);
  check('§2.2 klines weight: limit=500 (Phase B) → 5', binance.klinesWeight(500) === 5);
  check('§2.2 weight cap is 1200/min', binance.WEIGHT_CAP_PER_MIN === 1200);

  console.log(`\n${failures === 0 ? '✓ all data-plane failover checks passed' : `✗ ${failures} check(s) failed`}\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
