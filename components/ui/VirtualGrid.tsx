'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * §5.3  WINDOWED VIRTUALISATION for large coin grids.
 *
 * The RSI Heatmap can place 300+ tiles inside a single zone. Rendering them
 * all costs ~600 live DOM nodes per zone and makes every 1 Hz tick update
 * expensive, so we render only the rows that intersect the viewport and pad
 * with two spacers.
 *
 * Rows stay `display:flex; justify-content:center` so the visual result is
 * byte-identical to the un-virtualised `flex flex-wrap` grid it replaces —
 * only the DOM cost changes.
 *
 * Works with PAGE-level scrolling (not an inner scroll container), because the
 * heatmap zones stack inside the document flow.
 */

export interface VirtualGridProps<T> {
  items: T[];
  keyOf: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  tileWidth: number;
  tileHeight: number;
  gap?: number;
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
  className?: string;
  /** Bumped by the caller when tile sizes change (e.g. density toggle). */
  remeasureKey?: string | number;
}

export function VirtualGrid<T>({
  items,
  keyOf,
  renderItem,
  tileWidth,
  tileHeight,
  gap = 6,
  overscan = 3,
  className = '',
  remeasureKey,
}: VirtualGridProps<T>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [top, setTop] = useState(0);
  const [viewportH, setViewportH] = useState(900);
  const [scrollY, setScrollY] = useState(0);

  const measure = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const rect = el.getBoundingClientRect();
    setTop(rect.top + (typeof window === 'undefined' ? 0 : window.scrollY));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, remeasureKey, tileWidth, tileHeight, gap]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const onScroll = () => setScrollY(window.scrollY);
    const onResize = () => {
      setViewportH(window.innerHeight);
      measure();
    };

    setViewportH(window.innerHeight);
    onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [measure]);

  const cols = Math.max(1, Math.floor((width + gap) / (tileWidth + gap)));
  const rowH = tileHeight + gap;
  const rowCount = Math.ceil(items.length / cols);

  /* Nothing measured yet — render the first screenful un-windowed so the grid
     is never blank on first paint (§5.1). */
  const measured = width > 0;

  const firstVisible = measured ? Math.floor((scrollY - top) / rowH) : 0;
  const lastVisible = measured ? Math.ceil((scrollY - top + viewportH) / rowH) : 6;
  const startRow = Math.max(0, firstVisible - overscan);
  const endRow = Math.min(rowCount, lastVisible + overscan);

  const rows: Array<{ index: number; slice: Array<{ item: T; index: number }> }> = [];
  for (let r = startRow; r < endRow; r += 1) {
    const slice = items.slice(r * cols, r * cols + cols).map((item, i) => ({ item, index: r * cols + i }));
    rows.push({ index: r, slice });
  }

  return (
    <div ref={hostRef} className={className}>
      {startRow > 0 ? <div style={{ height: startRow * rowH }} aria-hidden="true" /> : null}

      {rows.map((row) => (
        <div
          key={row.index}
          className="flex justify-center"
          style={{ gap, height: tileHeight, marginBottom: gap }}
        >
          {row.slice.map(({ item, index }) => (
            <div key={keyOf(item, index)} style={{ width: tileWidth, height: tileHeight }} className="shrink-0">
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      ))}

      {endRow < rowCount ? <div style={{ height: (rowCount - endRow) * rowH }} aria-hidden="true" /> : null}
    </div>
  );
}
