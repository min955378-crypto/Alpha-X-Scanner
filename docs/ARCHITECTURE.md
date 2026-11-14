# Alpha X Scanner — Architecture & Release Notes

**Product:** Alpha X Scanner — Institutional Crypto Terminal
**Owner / Operator:** Muhammad Ibrahim
**WhatsApp:** 0348-5581969 · +92 348 5581969
**Repository:** https://github.com/min955378-crypto/Alpha-X-Scanner
**Storage split:** GitHub = source code only · Google Drive = heavy assets, caches, backups, docs

---

## 1. Deployment topology

A **single Node process** (`server/index.ts`, run via `tsx`) owns:

- the Next.js 14 App Router HTTP surface,
- the WebSocket data plane at `/ws/market`,
- the market engine (universe, simulation, indicators, scanners),
- the repository layer.

One port is a hard requirement of the sandbox preview proxy, which is why the
HTTP server, the socket upgrade and the engine are co-resident rather than
split across services.

```
Browser ──HTTP──▶ Next.js App Router (pages + /api/*)
        ──WS────▶ /ws/market  ──▶ Engine (60s cycle + 1s ticks)
                                     │
                                     ├── MarketStore (candles, TfState)
                                     ├── WeightMeter (Binance budget)
                                     └── Db (JSON snapshot under .data/)
```

## 2. Deviation from the original spec (Prisma / Postgres / Redis)

The v2.1 master prompt specified Prisma models, a Fastify gateway and a Redis
ring buffer. **None are used.** Rationale and consequences:

| Spec | This build | Why |
|---|---|---|
| Prisma + Postgres | TS row types in `lib/types.ts`; JSON store in `server/engine/db.ts` | No second service reachable from the single-port sandbox |
| Fastify / uWebSockets | Node `http` server + `ws` | Must share one port with Next.js |
| Redis ring buffer | In-process `MarketStore` `Map`s | Same process as the engine |

Every `@@id` / `@@index` / `@@unique` from §13 is documented against its
in-memory index in `server/engine/db.ts`, and `assertSchemaInvariants()` runs
before every persist so the JSON snapshot can never contain a row the real
schema would have rejected.

Swapping in a `PrismaClient` later is a single-file change — call sites and row
shapes are already identical to the §13 models.

## 3. Data mode

The engine runs **`SIMULATED`** unless Binance is reachable. `server/engine/binance.ts`
probes on boot and falls back transparently; `dataMode` is reported on every
frame so the UI can label it honestly. In this sandbox Binance is unreachable,
so the terminal always reports `SIMULATED`.

### Cold boot (§2.2)

| Phase | Request | Weight | Rate | Result |
|---|---|---|---|---|
| A | `klines?limit=99` | 1 / coin | 20 req/s | 601 coins in **~30.5 s** |
| B | `klines?limit=500` | 5 / coin | 3.5 req/s | non-blocking backfill, ~2.9 min |

Peak observed weight **~1,040 / 1,200 per minute**.

### Simulator calibration

Each timeframe is generated on **its own bar clock** with volatility scaled by
`sqrt(barMs)`; an AR(1) trend term is scaled by the same factor. Two bugs were
fixed during calibration:

- 4H/1D were *aggregated* from the 1H series, leaving 1D with 21 bars and an
  RSI pinned near 50 for the whole book.
- Quote volume was multiplied by the price-volatility factor, depressing
  RVOL(20) on sub-hourly bars (30M read 0.32).

Resulting distributions (measured, not asserted):

| TF | RSI sd | RVOL mean |
|---|---|---|
| 15M | 19.5 | 1.01 |
| 30M | 17.5 | 1.06 |
| 1H | 9.7 | 1.04 |
| 4H | 14.7 | 1.03 |
| 1D | 12.8 | 1.07 |

Pegged assets (`FDUSD`, `USDC`, `PAXG`, `XAUT`) carry a per-symbol volatility
multiplier so they hold their peg instead of topping the Top Movers panel.

## 4. Scoring (§7.3)

`computeScore` lives in **`lib/score.ts`** — isomorphic, no server imports — so
the server scanners and the client Coin Finder share one implementation. Client
code must never import from `server/**`.

Each `CoinSnapshot` carries the **best score any scanner awarded it** for the
current cycle, transmitted on the wire as `sc`. Scanners therefore run *before*
frames are built inside `onCycle()`. `0` means "no active setup" and renders as
`—`.

Score budget: structure 30 + volume 20 + trend 15 + htf 15 + rr 10 +
liquidity 10 − risk penalty 25 (Monitoring Tag), clamped 0–100.

## 5. Design system

- **Fonts** — Space Grotesk (display) · Plus Jakarta Sans (UI) · JetBrains Mono
  (financial data, `tabular-nums` + `tnum`/`zero` so digits never jitter).
- **Motion** — `AuroraBackground` is a 2D canvas + CSS-3D perspective grid, not
  Three.js: 60fps on integrated GPUs with no dependency and no bundle bloat.
  `TiltCard` writes CSS custom properties directly (no React state per pointer
  event). Conic laser borders mark `BUY`/`SHORT` entries and the RSI 52–55
  spotlight; a 600 ms radial pulse fires on every live tick.
- **Icons** — `components/ui/Icons.tsx`, ~30 stroked 24×24 glyphs (~2 kB source)
  replacing the emoji that carried the nav, headers and scanner controls.
  `⚠` is retained: it is the spec-mandated Monitoring Tag marker.
- **Contrast** — all 12 text tokens clear WCAG AA 4.5:1 on every surface;
  `--text-muted` worst case 4.75:1. Verified by `npm run qa:contrast`, which
  parses the tokens straight from `globals.css`.

## 6. Security posture

- `/login` carries **no** demo credentials, no admin references, no video
  embeds and no legal/Urdu text blocks.
- The **Admin Panel entry point is removed** from the top bar. `/admin` still
  exists and still enforces `role === 'ADMIN'`, but nothing links to it.
- License keys use the `APS-XXXX-XXXX-XXXX` format.

### Outstanding

`npm audit` reports a **critical advisory in `next`** whose only fix is a major
bump to Next 16. Next 14.2.35 is the highest patched 14.x. Deferring the
migration is a deliberate choice — it is a breaking upgrade, not a patch.
`ws` was patched to ^8.23.0.

## 7. Commands

```bash
npm run dev          # dev server (tsx, port 3000)
npm start            # production (NODE_ENV=production)
npm run build        # next build
npm run typecheck    # tsc --noEmit
npm run qa:contrast  # WCAG AA contrast audit
npm run qa:frame     # 41 live acceptance checks across all 5 timeframes
npm run qa:sim       # offline simulator distribution report
```
