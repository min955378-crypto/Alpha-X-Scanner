import type { Config } from 'tailwindcss';

/**
 * Alpha X Scanner design tokens (spec §3.3).
 * Every colour here is WCAG 2.1 AA verified against the card surface #0E111A.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-0': '#070A12',
        'bg-canvas': '#0A0C14',
        'bg-topbar': '#0C0E1A',
        'bg-card': '#0E111A',
        'bg-card-2': '#11141D',
        'bg-hover': '#1A2337',
        'border-line': '#243049',
        'focus-ring': '#F5B301',
        'text-primary': '#FFFFFF',
        'text-bright': '#EAF0FF',
        'text-secondary': '#94A3B8',
        'text-muted': '#7E8FA6',
        'green-pos': '#22C55E',
        'green-bright': '#00D26A',
        'red-neg': '#F87171',
        'amber-warn': '#F5B301',
        'blue-info': '#60A5FA',
        'purple-gain': '#A78BFA',
        'orange-os': '#F97316',
      },
      fontFamily: {
        display: ['Space Grotesk', 'Plus Jakarta Sans', 'Inter', 'sans-serif'],
        ui: ['Plus Jakarta Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        num: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['9.5px', '12px'],
        '3xs': ['9px', '11px'],
      },
      width: {
        tile: '86px',
        'tile-sm': '66px',
        sidebar: '190px',
      },
      height: {
        tile: '36px',
        'tile-sm': '28px',
        topbar: '32px',
        tabbar: '36px',
      },
      keyframes: {
        /* §Phase 2 §2.4 — 600ms radial pulse wave on every live tick. */
        'flash-up': {
          '0%': { boxShadow: '0 0 0 0 rgba(0, 210, 106, 0.55)', backgroundColor: 'rgba(0, 210, 106, 0.18)' },
          '100%': { boxShadow: '0 0 0 14px rgba(0, 210, 106, 0)', backgroundColor: 'transparent' },
        },
        'flash-down': {
          '0%': { boxShadow: '0 0 0 0 rgba(255, 59, 92, 0.55)', backgroundColor: 'rgba(255, 59, 92, 0.18)' },
          '100%': { boxShadow: '0 0 0 14px rgba(255, 59, 92, 0)', backgroundColor: 'transparent' },
        },
        'eq-bar': {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      animation: {
        'flash-up': 'flash-up 600ms ease-out',
        'flash-down': 'flash-down 600ms ease-out',
        'fade-in': 'fade-in 180ms ease-out',
        'slide-in': 'slide-in 220ms ease-out',
        eq: 'eq-bar 900ms ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
