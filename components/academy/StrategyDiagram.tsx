'use client';

import type { DiagramKind } from '@/lib/academy';

/**
 * §6.2  Schematic SVG blueprints for the Alpha X Strategy Academy.
 *
 * These are hand-built vector diagrams rather than screenshots so they stay
 * crisp at any density, inherit the semantic palette, and can never drift out
 * of sync with the playbook text — each `DiagramKind` maps 1:1 to a module.
 *
 * §7.1  Colour contract: bullish / entry / TP = emerald (#00D26A / #22C55E),
 * bearish / invalidation / SL = crimson (#EF4444). Never altered.
 */

const EMERALD = '#00D26A';
const EMERALD_SOFT = '#22C55E';
const CRIMSON = '#EF4444';
const VIOLET = '#8B5CF6';
const AMBER = '#F5B301';
const AXIS = '#7E8FA6';
const GRID = 'rgba(255,255,255,0.06)';

const W = 640;
const H = 320;

/** Shared chrome: faint grid, rounded panel, corner caption. */
function Frame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={caption}>
      <defs>
        <linearGradient id="ax-glow-up" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={EMERALD} stopOpacity="0" />
          <stop offset="100%" stopColor={EMERALD} stopOpacity="0.18" />
        </linearGradient>
        <filter id="ax-ds" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="currentColor" floodOpacity="0.55" />
        </filter>
      </defs>

      <rect x="0" y="0" width={W} height={H} rx="10" fill="#0A0C14" />
      {[40, 80, 120, 160, 200, 240, 280].map((y) => (
        <line key={y} x1="0" y1={y} x2={W} y2={y} stroke={GRID} strokeWidth="1" />
      ))}
      {[80, 160, 240, 320, 400, 480, 560].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2={H} stroke={GRID} strokeWidth="1" />
      ))}

      {children}

      <text x="14" y={H - 12} fill={AXIS} fontSize="10" fontFamily="ui-monospace, monospace" opacity="0.75">
        {caption}
      </text>
    </svg>
  );
}

/** Right-hand price ladder: TP2 → TP1 → Entry → SL. */
function Ladder({
  levels,
}: {
  levels: Array<{ y: number; label: string; color: string }>;
}) {
  return (
    <g>
      {levels.map((l) => (
        <g key={l.label}>
          <line x1="470" y1={l.y} x2={W - 8} y2={l.y} stroke={l.color} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.85" />
          <rect x={W - 76} y={l.y - 9} width="68" height="18" rx="4" fill={l.color} fillOpacity="0.14" stroke={l.color} strokeOpacity="0.55" />
          <text
            x={W - 42}
            y={l.y + 4}
            fill={l.color}
            fontSize="10"
            fontWeight="700"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
          >
            {l.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/* ------------------------------- 01 · RSI ------------------------------- */

function RsiZones() {
  const bands = [
    { y: 20, h: 44, label: '60+ Gainers', color: EMERALD, fill: 0.2 },
    { y: 64, h: 44, label: '50–60 V1 Zone', color: AMBER, fill: 0.16 },
    { y: 108, h: 44, label: '40–50 Neutral', color: AXIS, fill: 0.08 },
    { y: 152, h: 44, label: '30–40 Reload', color: '#38BDF8', fill: 0.14 },
    { y: 196, h: 44, label: '20–30 Oversold', color: '#F97316', fill: 0.16 },
    { y: 240, h: 44, label: '10–20 Extreme', color: CRIMSON, fill: 0.2 },
  ];

  return (
    <Frame caption="Fig 1 — Six-zone RSI regime map · the 52–55 sweet spot sits inside the V1 Zone">
      {bands.map((b) => (
        <g key={b.label}>
          <rect x="60" y={b.y} width="330" height={b.h} fill={b.color} fillOpacity={b.fill} />
          <rect x="60" y={b.y} width="330" height={b.h} fill="none" stroke={b.color} strokeOpacity="0.35" />
          <text x="68" y={b.y + 16} fill={b.color} fontSize="10.5" fontWeight="700">
            {b.label}
          </text>
        </g>
      ))}

      {/* The 52–55 spotlight slice */}
      <rect x="60" y="76" width="330" height="20" fill={AMBER} fillOpacity="0.4" />
      <rect x="60" y="76" width="330" height="20" fill="none" stroke={AMBER} strokeWidth="1.4" />
      <text x="406" y="90" fill={AMBER} fontSize="10.5" fontWeight="800">
        ← 52–55 RISING
      </text>

      {/* Rising RSI line */}
      <path
        d="M 70 250 L 120 232 L 168 244 L 214 206 L 258 190 L 300 150 L 342 122 L 382 92"
        fill="none"
        stroke={EMERALD}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="382" cy="92" r="4.5" fill={EMERALD} />
      <text x="330" y="76" fill={EMERALD} fontSize="10" fontWeight="700">
        RSI(14) rising 3 bars
      </text>

      {/* 50 midline */}
      <line x1="60" y1="108" x2="390" y2="108" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="6 4" />
      <text x="66" y="104" fill="#FFFFFF" fontSize="9.5" opacity="0.7">
        50 midline
      </text>

      <Ladder
        levels={[
          { y: 60, label: 'TP2 3R', color: EMERALD },
          { y: 110, label: 'TP1 1.5R', color: EMERALD_SOFT },
          { y: 175, label: 'Entry', color: '#FFFFFF' },
          { y: 250, label: 'SL < 50', color: CRIMSON },
        ]}
      />
    </Frame>
  );
}

/* --------------------------- 02 · V1 breakout --------------------------- */

function V1Breakout() {
  return (
    <Frame caption="Fig 2 — V1 Scaling · compression release on RVOL ≥ 1.5">
      {/* Compression box */}
      <rect x="120" y="150" width="150" height="72" fill={AMBER} fillOpacity="0.1" stroke={AMBER} strokeOpacity="0.5" strokeDasharray="4 3" />
      <text x="128" y="142" fill={AMBER} fontSize="10" fontWeight="700">
        COMPRESSION (V1 zone)
      </text>

      {/* Resistance */}
      <line x1="60" y1="150" x2="300" y2="150" stroke={CRIMSON} strokeWidth="1.6" strokeDasharray="6 4" />
      <text x="62" y="144" fill={CRIMSON} fontSize="9.5" fontWeight="700">
        SWING HIGH
      </text>

      {/* Pre-breakout chop */}
      <path
        d="M 70 190 L 95 168 L 120 186 L 145 162 L 170 188 L 195 166 L 220 184 L 245 160"
        fill="none"
        stroke={AXIS}
        strokeWidth="1.8"
      />

      {/* Displacement + breakout candle */}
      <g>
        <rect x="278" y="96" width="12" height="62" fill={EMERALD} fillOpacity="0.85" />
        <line x1="284" y1="86" x2="284" y2="160" stroke={EMERALD} strokeWidth="2" />
        <rect x="298" y="74" width="12" height="52" fill={EMERALD} fillOpacity="0.85" />
        <line x1="304" y1="64" x2="304" y2="130" stroke={EMERALD} strokeWidth="2" />
      </g>
      <text x="318" y="72" fill={EMERALD} fontSize="10.5" fontWeight="800">
        RVOL 1.8 ✦ CLOSE BEYOND
      </text>

      {/* Continuation */}
      <path d="M 316 108 L 350 96 L 384 74 L 418 62 L 450 52" fill="none" stroke={EMERALD} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="450" cy="52" r="4" fill={EMERALD} />

      <Ladder
        levels={[
          { y: 58, label: 'TP2 3R', color: EMERALD },
          { y: 104, label: 'TP1 1.5R', color: EMERALD_SOFT },
          { y: 152, label: 'Entry', color: '#FFFFFF' },
          { y: 222, label: 'SL in box', color: CRIMSON },
        ]}
      />
      <text x="128" y="238" fill={CRIMSON} fontSize="9.5">
        ✕ close back inside the box = failed breakout
      </text>
    </Frame>
  );
}

/* --------------------------- 03 · Order block --------------------------- */

function OrderBlock() {
  return (
    <Frame caption="Fig 3 — Institutional Order Block · BOS + FVG + unmitigated retest">
      {/* Downtrend into the block */}
      <path d="M 60 96 L 100 116 L 140 104 L 180 132 L 215 124" fill="none" stroke={CRIMSON} strokeWidth="2" />

      {/* The order block — last opposing (bearish) candle */}
      <rect x="176" y="118" width="14" height="34" fill={CRIMSON} fillOpacity="0.75" />
      <rect x="170" y="112" width="34" height="48" fill={CRIMSON} fillOpacity="0.1" stroke={CRIMSON} strokeOpacity="0.6" />
      <text x="150" y="176" fill={CRIMSON} fontSize="9.5" fontWeight="700" textAnchor="middle">
        OB
      </text>

      {/* Impulse / BOS with FVG */}
      <path d="M 204 130 L 250 86 L 300 60 L 350 40" fill="none" stroke={EMERALD} strokeWidth="2.6" strokeLinecap="round" />
      <line x1="120" y1="96" x2="380" y2="96" stroke="#FFFFFF" strokeOpacity="0.3" strokeDasharray="5 4" />
      <text x="300" y="90" fill="#FFFFFF" fontSize="9.5" opacity="0.75">
        BOS
      </text>

      {/* Fair Value Gap */}
      <rect x="252" y="70" width="34" height="30" fill={VIOLET} fillOpacity="0.18" stroke={VIOLET} strokeOpacity="0.65" strokeDasharray="3 3" />
      <text x="290" y="66" fill={VIOLET} fontSize="9.5" fontWeight="700">
        FVG
      </text>

      {/* Retest of the block */}
      <path d="M 350 40 L 392 74 L 430 116 L 462 138" fill="none" stroke={AXIS} strokeWidth="2" strokeDasharray="5 4" />
      <circle cx="462" cy="138" r="5" fill={EMERALD} />
      <text x="404" y="160" fill={EMERALD} fontSize="10.5" fontWeight="800">
        ENTRY ↑
      </text>

      <Ladder
        levels={[
          { y: 54, label: 'TP2 3R', color: EMERALD },
          { y: 92, label: 'TP1 liq', color: EMERALD_SOFT },
          { y: 140, label: 'Entry', color: '#FFFFFF' },
          { y: 186, label: 'SL distal', color: CRIMSON },
        ]}
      />
      <text x="62" y="252" fill={AXIS} fontSize="9.5">
        ✕ full mitigation through the block = setup void
      </text>
    </Frame>
  );
}

/* ---------------------------- 04 · EMA stack ---------------------------- */

function EmaStack() {
  const curve = (y0: number, amp: number, phase: number, k: number) => {
    const pts: string[] = [];
    for (let x = 60; x <= 470; x += 10) {
      const y = y0 + Math.sin((x + phase) / 78) * amp + (x / 470) * -k;
      pts.push(`${x},${y.toFixed(1)}`);
    }
    return `M ${pts.join(' L ')}`;
  };

  return (
    <Frame caption="Fig 4 — EMA 9 / 21 / 50 ribbon · enter the first pullback after the stack aligns">
      <path d={curve(200, 26, 0, 96)} fill="none" stroke={EMERALD} strokeWidth="2.2" />
      <path d={curve(212, 30, 26, 78)} fill="none" stroke={AMBER} strokeWidth="2.2" />
      <path d={curve(224, 34, 52, 54)} fill="none" stroke="#38BDF8" strokeWidth="2.2" />

      {/* Legend */}
      <g fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="700">
        <rect x="486" y="24" width="10" height="3" fill={EMERALD} />
        <text x="502" y="29" fill={EMERALD}>
          EMA 9
        </text>
        <rect x="486" y="44" width="10" height="3" fill={AMBER} />
        <text x="502" y="49" fill={AMBER}>
          EMA 21
        </text>
        <rect x="486" y="64" width="10" height="3" fill="#38BDF8" />
        <text x="502" y="69" fill="#38BDF8">
          EMA 50
        </text>
      </g>

      {/* Crossover marker */}
      <circle cx="196" cy="176" r="7" fill="none" stroke={EMERALD} strokeWidth="2" />
      <text x="150" y="152" fill={EMERALD} fontSize="10" fontWeight="800">
        ✦ 9/21 CROSS
      </text>

      {/* Pullback entry */}
      <circle cx="368" cy="128" r="5" fill={EMERALD} />
      <text x="330" y="118" fill={EMERALD} fontSize="10.5" fontWeight="800">
        PULLBACK ENTRY
      </text>

      {/* Failure: close through EMA 50 */}
      <line x1="248" y1="248" x2="330" y2="248" stroke={CRIMSON} strokeWidth="2" />
      <text x="336" y="252" fill={CRIMSON} fontSize="9.5" fontWeight="700">
        close &lt; EMA 50 = void
      </text>

      <Ladder
        levels={[
          { y: 70, label: 'TP2 trail', color: EMERALD },
          { y: 118, label: 'TP1 1.5R', color: EMERALD_SOFT },
          { y: 168, label: 'Entry', color: '#FFFFFF' },
          { y: 240, label: 'SL < 50', color: CRIMSON },
        ]}
      />
    </Frame>
  );
}

/* ------------------------- 05 · Hidden divergence ----------------------- */

function HiddenDivergence() {
  return (
    <Frame caption="Fig 5 — Hidden bullish divergence · price higher low vs RSI lower low (continuation)">
      {/* Price panel */}
      <text x="60" y="30" fill="#FFFFFF" fontSize="10.5" fontWeight="800">
        PRICE
      </text>
      <path d="M 70 130 L 130 92 L 176 122 L 232 78 L 292 112 L 342 96 L 402 66" fill="none" stroke={AXIS} strokeWidth="2.2" />
      <circle cx="176" cy="122" r="5" fill={EMERALD} />
      <circle cx="342" cy="96" r="5" fill={EMERALD} />
      <line x1="176" y1="122" x2="342" y2="96" stroke={EMERALD} strokeWidth="1.6" strokeDasharray="5 4" />
      <text x="252" y="146" fill={EMERALD} fontSize="10" fontWeight="800">
        HIGHER LOW ↗
      </text>

      {/* Divider */}
      <line x1="40" y1="186" x2="600" y2="186" stroke={GRID} strokeWidth="1" />

      {/* RSI panel */}
      <text x="60" y="212" fill="#FFFFFF" fontSize="10.5" fontWeight="800">
        RSI(14)
      </text>
      <rect x="60" y="228" width="380" height="60" fill="#38BDF8" fillOpacity="0.06" />
      <text x="66" y="242" fill="#38BDF8" fontSize="9" fontWeight="700">
        30–40 RELOAD BAND
      </text>
      <path d="M 70 240 L 130 226 L 176 256 L 232 232 L 292 264 L 342 272 L 402 244" fill="none" stroke={VIOLET} strokeWidth="2.2" />
      <circle cx="176" cy="256" r="5" fill={CRIMSON} />
      <circle cx="342" cy="272" r="5" fill={CRIMSON} />
      <line x1="176" y1="256" x2="342" y2="272" stroke={CRIMSON} strokeWidth="1.6" strokeDasharray="5 4" />
      <text x="382" y="286" fill={CRIMSON} fontSize="10" fontWeight="800">
        LOWER LOW ↘
      </text>

      <Ladder
        levels={[
          { y: 62, label: 'TP2 ext', color: EMERALD },
          { y: 100, label: 'TP1 1.5R', color: EMERALD_SOFT },
          { y: 150, label: 'Entry', color: '#FFFFFF' },
          { y: 262, label: 'SL < HL', color: CRIMSON },
        ]}
      />
    </Frame>
  );
}

/* --------------------------- 06 · Alpha Sniper -------------------------- */

function SniperBand() {
  const pts: string[] = [];
  for (let x = 60; x <= 460; x += 8) {
    const y = 190 + Math.sin((x - 60) / 52) * 62;
    pts.push(`${x},${y.toFixed(1)}`);
  }

  return (
    <Frame caption="Fig 6 — Alpha Sniper · EMA(RSI(14), 3) inside the 30–70 channel with the 500-candle win-rate filter">
      {/* Channel */}
      <rect x="60" y="128" width="400" height="124" fill={VIOLET} fillOpacity="0.07" />
      <line x1="60" y1="128" x2="470" y2="128" stroke={VIOLET} strokeWidth="1.6" strokeDasharray="6 4" />
      <line x1="60" y1="252" x2="470" y2="252" stroke={VIOLET} strokeWidth="1.6" strokeDasharray="6 4" />
      <line x1="60" y1="190" x2="470" y2="190" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="1.2" strokeDasharray="4 4" />
      <text x="66" y="122" fill={VIOLET} fontSize="10" fontWeight="800">
        70 · EXHAUSTION
      </text>
      <text x="66" y="186" fill="#FFFFFF" fontSize="9.5" opacity="0.7">
        50 · MIDLINE
      </text>
      <text x="66" y="270" fill={VIOLET} fontSize="10" fontWeight="800">
        30 · EXHAUSTION
      </text>

      {/* Oscillator */}
      <path d={`M ${pts.join(' L ')}`} fill="none" stroke={VIOLET} strokeWidth="2.6" strokeLinecap="round" />

      {/* Trigger: cross back above 30 */}
      <circle cx="188" cy="252" r="6" fill={EMERALD} />
      <text x="196" y="276" fill={EMERALD} fontSize="10.5" fontWeight="800">
        ✦ ENTRY · cross ↑ 30
      </text>
      <circle cx="380" cy="128" r="6" fill={EMERALD_SOFT} />
      <text x="336" y="118" fill={EMERALD_SOFT} fontSize="10" fontWeight="800">
        TP1 · 70 rail
      </text>

      {/* Win-rate HUD */}
      <g>
        <rect x="486" y="212" width="146" height="70" rx="6" fill="#11141F" stroke={VIOLET} strokeOpacity="0.4" />
        <text x="496" y="230" fill={VIOLET} fontSize="9.5" fontWeight="800" fontFamily="ui-monospace, monospace">
          500-CANDLE HUD
        </text>
        <text x="496" y="248" fill={AXIS} fontSize="9" fontFamily="ui-monospace, monospace">
          TRADES 218 · WIN 141
        </text>
        <text x="496" y="264" fill={AXIS} fontSize="9" fontFamily="ui-monospace, monospace">
          LOSS 77 · ACTIVE 4
        </text>
        <text x="496" y="278" fill={EMERALD} fontSize="10" fontWeight="800" fontFamily="ui-monospace, monospace">
          WIN RATE 64.7% ✓
        </text>
      </g>

      <Ladder
        levels={[
          { y: 128, label: 'TP1 70', color: EMERALD_SOFT },
          { y: 190, label: 'Trail 50', color: '#FFFFFF' },
          { y: 252, label: 'Entry 30', color: EMERALD },
          { y: 288, label: 'SL 1 ATR', color: CRIMSON },
        ]}
      />
    </Frame>
  );
}

const REGISTRY: Record<DiagramKind, () => JSX.Element> = {
  'rsi-zones': RsiZones,
  'v1-breakout': V1Breakout,
  'order-block': OrderBlock,
  'ema-stack': EmaStack,
  'hidden-divergence': HiddenDivergence,
  'sniper-band': SniperBand,
};

export function StrategyDiagram({ kind }: { kind: DiagramKind }) {
  const Cmp = REGISTRY[kind] ?? RsiZones;
  return <Cmp />;
}
