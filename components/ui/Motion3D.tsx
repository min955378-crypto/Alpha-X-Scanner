'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/* -------------------------------------------------------------------------- */
/* §5.2  Interactive 3D background                                            */
/* -------------------------------------------------------------------------- */

const ORBS = [
  { hue: '#00D26A', r: 0.34 }, // institutional emerald
  { hue: '#3B82F6', r: 0.28 }, // electric blue
  { hue: '#8B5CF6', r: 0.3 }, // violet
  { hue: '#22D3EE', r: 0.22 }, // cyan
];

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  size: number;
  tint: number;
}

/**
 * §5.2 / Phase 2 §2  Hardware-accelerated 3D perspective grid + volumetric
 * orbs + depth particles, parallaxing to the pointer.
 *
 * Deliberately a 2D canvas with a CSS-3D transformed grid rather than a
 * Three.js scene: it holds 60fps on integrated GPUs, adds no dependency, and
 * keeps the client bundle small (§Phase 2 §1 — never bloat the repo).
 */
export function AuroraBackground({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    let particles: Particle[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Scale particle count to area so a phone is not asked to draw 220 sprites.
      const count = Math.min(220, Math.round((w * h) / 9000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.2 + Math.random() * 0.8,
        vx: (Math.random() - 0.5) * 0.09,
        vy: (Math.random() - 0.5) * 0.09,
        size: 0.6 + Math.random() * 1.9,
        tint: Math.floor(Math.random() * ORBS.length),
      }));
    };

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = (e.clientX - rect.left) / Math.max(1, rect.width);
      pointer.ty = (e.clientY - rect.top) / Math.max(1, rect.height);
    };

    /* §5.3  Throttle the ambient loop to ~30fps and hard-pause it when the tab
       is hidden. A background canvas has no business competing with the data
       grid for the main thread or the battery. */
    const TARGET_FPS = 30;
    const FRAME_MS = 1000 / TARGET_FPS;
    let last = 0;
    let paused = document.hidden;

    const onVisibility = () => {
      paused = document.hidden;
      if (!paused) {
        last = 0;
        raf = requestAnimationFrame(draw);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const draw = (t: number) => {
      if (paused) return;
      if (last && t - last < FRAME_MS) {
        raf = requestAnimationFrame(draw);
        return;
      }
      last = t;
      // Ease toward the pointer so parallax glides instead of snapping.
      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;

      const px = (pointer.x - 0.5) * 2;
      const py = (pointer.y - 0.5) * 2;

      if (grid) {
        grid.style.transform = `translate3d(${px * -18}px, ${py * -14}px, 0) rotateX(${58 + py * 3}deg) rotateZ(0deg) scale(1.35)`;
      }

      ctx.clearRect(0, 0, w, h);

      // Volumetric drifting orbs.
      ctx.globalCompositeOperation = 'lighter';
      ORBS.forEach((orb, i) => {
        const phase = t / 1000 + i * 1.9;
        const cx = w * (0.5 + Math.cos(phase * 0.11 + i) * 0.3) + px * 40 * (i + 1) * 0.4;
        const cy = h * (0.5 + Math.sin(phase * 0.13 + i * 2) * 0.3) + py * 40 * (i + 1) * 0.4;
        const radius = Math.min(w, h) * orb.r * (1 + Math.sin(phase * 0.3) * 0.06);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        g.addColorStop(0, `${orb.hue}22`);
        g.addColorStop(0.45, `${orb.hue}0d`);
        g.addColorStop(1, '#00000000');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Depth particles — nearer (larger z) ones move and parallax more.
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        if (!reduce) {
          p.x += p.vx * p.z * 60;
          p.y += p.vy * p.z * 60;
        }
        if (p.x < -20) p.x = w + 20;
        else if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        else if (p.y > h + 20) p.y = -20;

        const ox = p.x + px * 26 * p.z;
        const oy = p.y + py * 26 * p.z;
        ctx.fillStyle = ORBS[p.tint].hue;
        ctx.globalAlpha = 0.1 + p.z * 0.42;
        ctx.beginPath();
        ctx.arc(ox, oy, p.size * p.z * 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div className="absolute inset-0 bg-bg-0" />
      {/* CSS-3D perspective floor grid, parallaxed by the pointer. */}
      <div className="absolute inset-0 [perspective:620px]">
        <div
          ref={gridRef}
          className="absolute -inset-[35%] opacity-[0.22] will-change-transform"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,210,106,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.14) 1px, transparent 1px)',
            backgroundSize: '58px 58px',
            transform: 'rotateX(58deg) scale(1.35)',
            maskImage: 'radial-gradient(ellipse 60% 55% at 50% 45%, #000 20%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 45%, #000 20%, transparent 78%)',
          }}
        />
      </div>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        /* §5.3  Promote to its own compositor layer so the aurora never
           repaints the data grid above it. */
        style={{ willChange: 'transform', transform: 'translateZ(0)' }}
      />
      {/* Vignette keeps text legible over the brightest orb. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(7,10,18,0.82)_100%)]" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §5.2  3D perspective tilt + cursor-tracking spotlight                      */
/* -------------------------------------------------------------------------- */

export interface TiltCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Max rotation in degrees. */
  max?: number;
  /** Disable on touch devices / dense lists where tilt hurts readability. */
  disabled?: boolean;
  spotlight?: boolean;
}

/**
 * §5.2  Smooth perspective tilt with a cursor-tracking radial spotlight.
 * Writes to CSS custom properties only — no React state per pointer event,
 * so a grid of 600 tiles can use this without re-rendering.
 */
export function TiltCard({
  children,
  className = '',
  style,
  max = 7,
  disabled = false,
  spotlight = true,
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = el.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width;
        const my = (e.clientY - rect.top) / rect.height;
        el.style.setProperty('--rx', `${(0.5 - my) * max * 2}deg`);
        el.style.setProperty('--ry', `${(mx - 0.5) * max * 2}deg`);
        el.style.setProperty('--mouse-x', `${mx * rect.width}px`);
        el.style.setProperty('--mouse-y', `${my * rect.height}px`);
      });
    };
    const onEnter = () => setActive(true);
    const onLeave = () => {
      setActive(false);
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };

    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [disabled, max]);

  return (
    <div
      ref={ref}
      className={`tilt-card ${spotlight ? 'tilt-spotlight' : ''} ${active ? 'is-active' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* §Phase 2 §2.4  Live tick pulse                                              */
/* -------------------------------------------------------------------------- */

/**
 * Returns a `tick-up` / `tick-down` class for ~600ms whenever `value` changes.
 * Effect-driven (never render-driven) so React 18 StrictMode double-invocation
 * cannot leave a tile stuck mid-pulse.
 */
export function useTickFlash(value: number): string {
  const lastRef = useRef<number | null>(null);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = lastRef.current;
    lastRef.current = value;
    if (prev === null || prev === value) return;
    setDir(value > prev ? 'up' : 'down');
    const t = setTimeout(() => setDir(null), 600);
    return () => clearTimeout(t);
  }, [value]);

  return dir === 'up' ? 'tick-up' : dir === 'down' ? 'tick-down' : '';
}
