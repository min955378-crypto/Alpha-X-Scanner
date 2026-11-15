'use client';

import type { SVGProps } from 'react';

/**
 * §4.2  Razor-sharp dual-tone vector icons.
 *
 * Replaces the emoji that used to carry the 7 nav tabs, table headers and
 * scanner controls. Every glyph is a 24×24 stroked path so it inherits
 * `currentColor`, scales cleanly, and picks up the neon drop-shadow from the
 * `.icon` utility in globals.css.
 *
 * No icon library dependency — this is ~2 kB of source versus ~40 kB for a
 * tree-shaken Lucide bundle across the surfaces we actually use.
 */

export type IconName = keyof typeof PATHS;

/** `[outline path, optional accent path]` — the accent renders at lower opacity. */
const PATHS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5'],
  bolt: ['M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z'],
  blocks: ['M4 4h7v7H4z', 'M13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  trending: ['M3 17l6-6 4 4 7-7', 'M14 8h6v6'],
  hidden: ['M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  crosshair: ['M12 3v4M12 17v4M3 12h4M17 12h4', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  shieldAlert: ['M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6l8-3Z', 'M12 8.5v4M12 16h.01'],
  table: ['M3 5h18v14H3z', 'M3 10h18M9 10v9M15 10v9'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M21 21l-4.3-4.3'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8L12 3.5Z'],
  candles: ['M7 3v18M17 3v18', 'M4 8h6M14 12h6'],
  play: ['M7 4.5 19 12 7 19.5V4.5Z'],
  pause: ['M8 5v14M16 5v14'],
  reset: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  scan: ['M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3', 'M7 12h10'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: ['M4 12.5 9 17.5 20 6.5'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  user: ['M20 21a8 8 0 0 0-16 0', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  key: ['M15 9a4 4 0 1 0-3.5 4L21 22', 'M18.5 7.5h.01'],
  logout: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 8 6 12l4 4M6 12h10'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 15H2a2 2 0 1 1 0-4h.6A1.7 1.7 0 0 0 4.1 9.6a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6h.1A1.7 1.7 0 0 0 10.6 3V2a2 2 0 1 1 4 0v.6a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H22a2 2 0 1 1 0 4h-.6a1.7 1.7 0 0 0-1.6 1Z'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  download: ['M12 3v12', 'M7 11l5 5 5-5M4 21h16'],
  chevronUp: ['M6 15l6-6 6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  external: ['M14 4h6v6', 'M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  volume: ['M11 5 6 9H3v6h3l5 4V5Z', 'M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12'],
  whatsapp: ['M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.2-5.2A8.5 8.5 0 1 1 21 11.5Z', 'M8.5 9.5c0 3.5 2.5 6 6 6l1-2-2-.5-1 1a5.5 5.5 0 0 1-3-3l1-1-.5-2-1.5 1.5Z'],
  layers: ['M12 3 3 8l9 5 9-5-9-5Z', 'M3 13l9 5 9-5'],
  activity: ['M3 12h4l3 8 4-16 3 8h4'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2'],
  filter: ['M3 5h18', 'M6 12h12M10 19h4'],
  book: ['M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2V5Z', 'M8 7h7M8 11h7'],
  spark: ['M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1', 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z'],
  warning: ['M12 3 2.5 20h19L12 3Z', 'M12 9.5V15M12 17.6h.01'],
} as const;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
  /** Extra utility classes (colour, etc.). */
  className?: string;
}

export function Icon({ name, size = 16, className = '', ...rest }: IconProps) {
  const [outline, accent] = PATHS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`icon shrink-0 ${className}`}
      {...rest}
    >
      <path d={outline} />
      {accent ? <path d={accent} opacity={0.55} /> : null}
    </svg>
  );
}

/** §4.1  Nav tab / section icon + label pairing used across the shell. */
export function IconLabel({
  icon,
  children,
  className = '',
}: {
  icon: IconName;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}
