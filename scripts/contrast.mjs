/** §3.3 / §14.2 — WCAG 2.1 AA contrast audit over every palette pairing. */
const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// Keep the flat surface list (the bg-* vars include a radial gradient we skip).
// Parsed straight out of app/globals.css so the audit can never drift from
// the tokens the app actually ships.
import { readFileSync } from 'node:fs';
const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const TEXTS = {};
const SURF = {};
for (const m of CSS.matchAll(/--((?:text|tile-warn)-[a-z]+|green-pos|green-bright|red-neg|amber-warn|blue-info|purple-gain|orange-os|bg-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  (m[1].startsWith('bg-') ? SURF : TEXTS)[m[1]] = m[2];
}

const SURFACES = { card: SURF['bg-card'] ?? '#0e111a', canvas: SURF['bg-canvas'] ?? '#0a0c14', topbar: SURF['bg-topbar'] ?? '#0c0e1a', card2: SURF['bg-card-2'] ?? '#11141d', hover: SURF['bg-hover'] ?? '#1a2337' };

let fails = 0;
console.log('token'.padEnd(16), Object.keys(SURFACES).map((s) => s.padStart(9)).join(''));
for (const [name, color] of Object.entries(TEXTS)) {
  const row = Object.entries(SURFACES).map(([, s]) => {
    const r = ratio(color, s);
    return (r.toFixed(2) + (r >= 4.5 ? ' ' : '!')).padStart(9);
  });
  const worst = Math.min(...Object.values(SURFACES).map((s) => ratio(color, s)));
  if (worst < 4.5) fails += 1;
  console.log(name.padEnd(16), row.join(''), ' worst', worst.toFixed(2));
}
console.log('\nAA body-text threshold 4.5:1 — tokens below it:', fails);
