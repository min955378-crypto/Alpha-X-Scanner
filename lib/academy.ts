/**
 * §6.2  ALPHA X STRATEGY ACADEMY — the native playbook that replaced the five
 * legacy YouTube embeds on /tutorials.
 *
 * Every entry is authored as an institutional blueprint: the exact entry
 * trigger, the invalidation level (SL), and the TP1 / TP2 ladder, paired with
 * a schematic SVG diagram key so the visual and the rules can never drift.
 *
 * Authored by Muhammad Ibrahim. All levels are expressed in R multiples
 * (1R = distance from entry to stop) so the same blueprint scales to any
 * timeframe and any account size.
 */

export type DiagramKind =
  | 'rsi-zones'
  | 'v1-breakout'
  | 'order-block'
  | 'ema-stack'
  | 'hidden-divergence'
  | 'sniper-band';

export interface PlaybookRule {
  label: string;
  value: string;
}

export interface Playbook {
  id: string;
  /** Short label used by the left-hand lesson rail. */
  lesson: string;
  title: string;
  /** The scanner that automates this blueprint, if any. */
  scanner: string | null;
  summary: string;
  diagram: DiagramKind;
  /** Confluence conditions that must all be true before entry. */
  checklist: string[];
  rules: PlaybookRule[];
  /** Shown under the diagram as the "what invalidates this" note. */
  invalidation: string;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'rsi-heatmap',
    lesson: 'Module 01',
    title: 'RSI Heatmap & the 52–55 Rising Momentum Sweet Spot',
    scanner: null,
    summary:
      'The heatmap is a single-glance regime map: it sorts every USDT pair into six RSI bands so you always know whether you are hunting mean-reversion or momentum continuation before you open a chart.',
    diagram: 'rsi-zones',
    checklist: [
      'RSI(14) is inside 52–55 — above the 50 midline but not yet overbought.',
      'RSI is rising across the last three closed candles (not a single-bar spike).',
      '24h change is positive, so the higher-timeframe tide is with you.',
      'RVOL(20) at or above 1.0 — real participation behind the move.',
    ],
    rules: [
      { label: 'Entry', value: 'Market or limit on the retest of the breakout candle close.' },
      { label: 'Invalidation (SL)', value: 'Below the swing low that started the RSI turn, or 1× ATR(14) — whichever is wider.' },
      { label: 'TP1', value: '1.5R. Book 50% and move the stop to break-even.' },
      { label: 'TP2', value: '3R, or trail the EMA 21 while RSI holds above 50.' },
      { label: 'Time stop', value: 'If RSI falls back below 50 before TP1, exit at market.' },
    ],
    invalidation:
      'A close back below RSI 50 kills the momentum thesis immediately — this is a continuation setup, so losing the midline means the premise is gone.',
  },
  {
    id: 'v1-scaling',
    lesson: 'Module 02',
    title: 'V1 Scaling Momentum Breakout Strategy',
    scanner: 'V1 Scaling',
    summary:
      'V1 Scaling hunts the exact moment a coil in the RSI 50–60 band releases. High relative volume plus a momentum-print close is the tell that institutions are scaling in, not distributing.',
    diagram: 'v1-breakout',
    checklist: [
      'RSI(14) sits in the 50–60 V1 zone on the active timeframe.',
      'Price is compressing under a clearly defined swing high.',
      'RVOL(20) ≥ 1.5 on the breakout candle — volume confirms intent.',
      'Candle closes beyond the level; a wick through it is not a breakout.',
    ],
    rules: [
      { label: 'Entry', value: 'Close of the breakout candle, or the first retest of the broken level.' },
      { label: 'Invalidation (SL)', value: 'Back inside the compression box, below the breakout candle low.' },
      { label: 'TP1', value: '1.5R at the next measured move of the compression range.' },
      { label: 'TP2', value: '3R, trailing under each higher low.' },
      { label: 'Add rule', value: 'Only add on a fresh high-RVOL close, never into a low-volume drift.' },
    ],
    invalidation:
      'A close back inside the box is a failed breakout — the liquidity above the high was swept. Stand aside until the range re-coils.',
  },
  {
    id: 'order-block',
    lesson: 'Module 03',
    title: 'Institutional Order Block (Demand / Supply + BOS + FVG)',
    scanner: 'Order Block',
    summary:
      'An order block is the last opposing candle before displacement — the footprint of institutional resting liquidity. The edge comes from entering on the retest, where the stop is tiny and the target is the next liquidity pool.',
    diagram: 'order-block',
    checklist: [
      'A strong impulsive move produces a Break of Structure (BOS).',
      'A Fair Value Gap (FVG) is left behind, confirming displacement.',
      'The last opposing candle before the impulse is tagged as the order block.',
      'The block is unmitigated — price has not yet traded back through it.',
    ],
    rules: [
      { label: 'Entry', value: 'Limit at the proximal edge of the unmitigated block.' },
      { label: 'Invalidation (SL)', value: 'Beyond the distal edge of the block plus a small buffer.' },
      { label: 'TP1', value: 'The opposing liquidity pool — the most recent swing high.' },
      { label: 'TP2', value: 'The measured move of the impulse leg, typically 3R+.' },
      { label: 'Mitigation', value: 'Once price trades through the full block, the setup is void.' },
    ],
    invalidation:
      'Full mitigation — price consumes the entire block without reacting. The resting orders are gone, so there is nothing left to defend.',
  },
  {
    id: 'ema-crossover',
    lesson: 'Module 04',
    title: 'EMA 9 / 21 / 50 Crossover & Dynamic Pullback',
    scanner: 'EMA Crossover',
    summary:
      'The EMA ribbon defines the trend; the crossover defines the trigger. The highest-probability entry is not the cross itself but the first pullback into the fast EMA after the stack has aligned.',
    diagram: 'ema-stack',
    checklist: [
      'The 9 / 21 / 50 stack is aligned in trend order (9 above 21 above 50 for longs).',
      'A fresh 9/21 crossover printed within the last few candles.',
      'Price pulls back into the EMA 21 without closing through the EMA 50.',
      'The pullback happens on declining volume — sellers are absent.',
    ],
    rules: [
      { label: 'Entry', value: 'First bullish reaction candle that closes back above the EMA 9.' },
      { label: 'Invalidation (SL)', value: 'A close through the EMA 50, not just an intrabar wick.' },
      { label: 'TP1', value: '1.5R at the prior swing high.' },
      { label: 'TP2', value: 'Trail the EMA 21 until it is closed through.' },
      { label: 'Stack rule', value: 'If the ribbon compresses and flattens, exit — the trend is over.' },
    ],
    invalidation:
      'A full close through the EMA 50 flips the structure. The stack has failed; do not average into it.',
  },
  {
    id: 'hidden-bullish',
    lesson: 'Module 05',
    title: 'Hidden Bullish / Bearish Divergence + ICT Structure',
    scanner: 'Hidden Bullish & ICT',
    summary:
      'Hidden divergence is a continuation signal, not a reversal: price prints a higher low while RSI prints a lower low. Inside the RSI 30–40 band it marks the point where the trend quietly reloads.',
    diagram: 'hidden-divergence',
    checklist: [
      'Price prints a higher low relative to the prior swing.',
      'RSI prints a lower low over the same two swings.',
      'RSI is inside the 30–40 reload band, not deeply oversold.',
      'The higher low holds — no close below it before entry triggers.',
    ],
    rules: [
      { label: 'Entry', value: 'On the close of the candle that confirms the higher low.' },
      { label: 'Invalidation (SL)', value: 'Below the higher low that created the divergence.' },
      { label: 'TP1', value: 'The prior swing high — typically 1.5R to 2R.' },
      { label: 'TP2', value: 'Extension beyond structure, trailing the EMA 21.' },
      { label: 'Regime filter', value: 'Only take hidden bullish setups in an uptrend; context is everything.' },
    ],
    invalidation:
      'A close below the higher low converts the pattern into a regular breakdown — the continuation thesis is dead.',
  },
  {
    id: 'alpha-sniper',
    lesson: 'Module 06',
    title: 'Alpha Sniper Oscillator (30–70 Band) & the 500-Candle Win-Rate Filter',
    scanner: 'Alpha Sniper',
    summary:
      'Alpha Sniper is EMA(RSI(14), 3) drawn inside a 30–70 channel. The 50 midline separates regimes; the 30 and 70 rails mark exhaustion. The 500-candle backtest tells you whether the signal is worth taking on that pair at all.',
    diagram: 'sniper-band',
    checklist: [
      'Alpha Sniper crosses back above 30 from below — exhaustion is releasing.',
      'The cross happens above the 50 midline for continuation trades.',
      'The 500-candle win rate for this pair and timeframe is at least 55%.',
      'Volume confirms; a sub-1.0 RVOL cross is noise.',
    ],
    rules: [
      { label: 'Entry', value: 'On the close of the candle that completes the cross.' },
      { label: 'Invalidation (SL)', value: '1× ATR(14), or below the swing low of the cross candle.' },
      { label: 'TP1', value: 'At the 70 rail — take 50% into exhaustion.' },
      { label: 'TP2', value: 'Trail while the oscillator holds above 50.' },
      { label: 'Filter', value: 'Skip any pair whose 500-candle win rate is below 55% or still warming up.' },
    ],
    invalidation:
      'A cross back below 50 before TP1 means the regime flipped. Exit at market rather than hoping.',
  },
];

/** §6.2  The support banner contact — identical to every other WhatsApp CTA. */
export const ACADEMY_AUTHOR = 'Muhammad Ibrahim';
