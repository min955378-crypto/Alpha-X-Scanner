# Alpha X Scanner — v2.5 "Instant Zero-Lag Terminal"

**Branch:** `arena/9605e311-alpha-x-scanner`
**Base:** `90934aa` (merge of PR #3)
**Date:** 2026-11-13

---

## Section 1 — Legacy brand purge & unified WhatsApp automation

Every legacy string is gone from source, styles, seeds and config:

| Purged | Replacement |
|---|---|
| `ScalpPro`, `scalppro:*` storage keys | `Alpha X Scanner`, `alphax:v2:*` |
| `scalp-usdt.com` | `alpha-x-scanner.com` |
| `Freedom With Aahad`, `Freedom With Nomi` | `Muhammad Ibrahim` |
| `+923164404787` | `0348-5581969` / `wa.me/923485581969` |
| `SPRO-` key prefix | `APS-` |
| Urdu legal paragraphs (`dir="rtl"`) | removed — English-only disclaimer |
| `Ultra Pro` / `Lite v1.2.8` | `Alpha X Pro` / `v2.5 Pro` |
| 5 legacy YouTube embeds | native Alpha X Strategy Academy |

**Single canonical WhatsApp CTA** (`BRAND.whatsappHref`) now drives every surface:
`/login`, Right Sidebar promo card, Top Bar "Your access" dropdown footer,
License Expired / Renewal modal, Disclaimer modal, Legal footer, Academy banner.

> **Scope note:** the Urdu legal paragraph, the bilingual glossary column and the
> Noto Nastaliq Urdu webfont were removed to satisfy the zero-`dir="rtl"`
> requirement. This is a real functional reduction (Urdu-reading users lose
> localised copy) and was done to the letter of the directive. If you want it
> back it should be reintroduced behind an explicit language toggle, which
> keeps `dir="rtl"` out of the default render path.

---

## Section 2 — One license key unlocks 100%

- **Padlock screen deleted.** `LockedScanner` is gone from `ScannerView`.
  All five scanners (`V1 Scaling`, `Order Block`, `EMA Crossover`,
  `Hidden Bullish`, `Alpha Sniper`) are always reachable.
- `LITE_ENTITLEMENTS` now carries the same all-true set as `ULTRA_PRO`.
- **Migration, not just reseeding** — `db.migrateUnlockAll()` promotes every
  already-persisted user and license to full access once, records an audit
  entry, and marks the snapshot with `unlockedAllAt`. Without this, an existing
  `.data` snapshot would have kept demo locked at 1/5 forever.
- **Verified:** demo (`APS-TRIAL-AA17-K4M2`) went 1/5 → **5/5** on this upgrade.
- Remaining gate is license *status* only (`ACTIVE` vs `EXPIRED`/`REVOKED`),
  centralised in `lib/license.ts`.
- Top Bar: `v2.5 Pro` badge, `Alpha X Pro ▾` dropdown, all five scanners with
  glowing `Active` badges, live validity countdown, bound key, renewal link.

> The persisted plan enum is still `LITE | ULTRA_PRO` so old snapshots keep
> loading; every user-facing surface renders `Alpha X Pro` via `planLabel()`.

---

## Section 3 — Zero admin/demo leaks & seamless login flow

- `/login` verified at runtime: 0 demo credentials, 0 Quick-Demo autofill,
  0 YouTube embeds, 0 Urdu/English disclaimer blocks.
- No Admin Portal button exists in the customer shell; `/admin` is reachable
  only by URL and role-gates non-admins back to `/dashboard`.
- All 12 platform features render in the 3D perspective bento grid with SVG
  vector icons.
- Post-login disclaimer: `type="button"` + `preventDefault`/`stopPropagation`,
  non-destructive state merge, best-effort persistence that can never 401-logout
  or redirect, unified `alphax:v2:*` storage. Regression suite: 21/21 pass.

---

## Section 4 — Bulletproof live public data plane

**REST host ladder (§4.1)** — sticky selection with exponential backoff:
1. `https://data-api.binance.vision` ← **primary** (public mirror, no geo-block)
2. `https://api.binance.com` ← mirror (451/403 in many cloud regions)

**WebSocket ladder (§4.2)** — same ordering, auto-promotes on drop:
1. `wss://data-stream.binance.vision:443`
2. `wss://stream.binance.com:9443`

New `MiniTickerStream` subscribes to `!miniTicker@arr` — 1 Hz price/volume for
the whole book on one socket at **zero REST weight**. `MarketStore.applyMiniTicker()`
feeds it straight into the forming candles so RSI/EMA/ATR/RVOL stay intrabar-accurate.

**Cross-exchange fallback (§4.3)** — Binance → **Bybit V5** → **CoinCap**.
`Ticker24` gained `bidPrice`/`askPrice`. Bybit's `price24hPcnt` is a ratio and is
converted to percent. CoinCap has no OHLC, so klines fall back to the synthetic feed.

**Charts (§4.4)** — dual mode, persisted per account:
- **Mode A** Alpha X Native Sniper Chart (TradingView Lightweight Charts):
  EMA 13 (`#00D26A`) / EMA 34 (`#EF4444`), unmitigated order-block zones,
  LAST 500 CANDLES backtest HUD, synchronised Alpha Sniper pane
  (`EMA(RSI(14),3)` in `#8B5CF6`, 30–70 channel, 50 midline).
- **Mode B** TradingView Advanced widget (`s3.tradingview.com/tv.js`), dark `#0A0C14`,
  full drawing toolbar, bound to `BINANCE:<symbol>`.
- New `GET /api/market/klines` serves 500 candles from the warm engine (zero extra
  REST weight), falling back to upstream when a symbol isn't backfilled.

**Verified:** 18/18 in `npm run qa:providers` — primary-host preference, 451
failover, backoff, Bybit fallback, CoinCap fallback, ratio→percent conversion,
probe semantics, leverage-token stripping, weight metering.

---

## Section 5 — Instant zero-lag architecture

- **Snapshot hydration:** last frame cached under `alphax:v2:market_snapshot` and
  decoded synchronously in `useState` initialiser → populated on first paint,
  with `status: 'cached'` until the socket confirms.
- Pre-computed all-5-scanner engine unchanged (runs every 60 s cycle).
- **Windowed virtualisation** for the heatmap coin grids (`components/ui/VirtualGrid.tsx`).
- Aurora canvas throttled to 30 fps, hard-paused on `document.hidden`, promoted to
  its own compositor layer.

---

## Section 6 — Alpha X Strategy Academy

Replaced the five YouTube embeds with six institutional blueprints
(`lib/academy.ts`), each with a hand-built schematic SVG
(`components/academy/StrategyDiagram.tsx`), a confluence checklist, execution
rules in R multiples, and an explicit invalidation note. Plus a searchable
15-term glossary and a Muhammad Ibrahim support banner.

---

## Section 7 — VFX, typography, iconography

Candlestick colours fixed (emerald `#00D26A`/`#22C55E` up, crimson `#EF4444` down).
Typography already correct: Space Grotesk / Plus Jakarta Sans / JetBrains Mono with
tabular numerals. `.icon` neon drop-shadow in place. Conic laser borders extended to
the 12 feature cards and the Muhammad Ibrahim contact card (already on the login gate,
RSI 52–55 spotlight and signal cards).

---

## Verification performed

- `npm run typecheck` — clean
- `npm run build` — ✓ Compiled successfully
- `npm run qa:disclaimer` — 21/21
- `npm run qa:providers` — 18/18 (new)
- Live: admin + demo both log in 200, session 5/5 scanners, disclaimer 200,
  klines 500 candles from engine, all 5 scanner pages render with 0 padlocks

## Known limitation

This sandbox has outbound network only to `github.com`, `npmjs.org` and `pypi.org`,
so **no exchange was actually reachable**. The engine therefore ran in `SIMULATED`
mode and `provider: NONE` throughout. The failover *logic* is proven by the
mock-fetch suite; the live end-to-end path still needs one run on a host with
general internet access to confirm `provider: binance` and `dataMode: LIVE`.
