'use client';

import { useMemo } from 'react';

import QRCode from 'qrcode';

/**
 * §2.3  Provisioning QR code, rendered as inline SVG.
 *
 * Built from the module matrix directly rather than requesting an image from
 * any external service: the setup key is a live credential and must never
 * leave the browser, and `/admin` has to work on an air-gapped machine. Inline
 * SVG also stays crisp at any zoom level, which matters when someone is
 * pointing a phone camera at a laptop screen.
 */
export function QRCodeSVG({
  value,
  size = 180,
  dark = '#000000',
  light = '#FFFFFF',
}: {
  value: string;
  size?: number;
  dark?: string;
  light?: string;
}) {
  const { path, modules } = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      const data = qr.modules.data;
      let d = '';
      for (let row = 0; row < n; row += 1) {
        for (let col = 0; col < n; col += 1) {
          /* `data` is a flat row-major bit matrix; 1 means a dark module. */
          if (data[row * n + col]) d += `M${col} ${row}h1v1h-1z`;
        }
      }
      return { path: d, modules: n };
    } catch {
      return { path: '', modules: 0 };
    }
  }, [value]);

  if (!modules) {
    return (
      <div
        role="img"
        aria-label="QR code unavailable"
        style={{ width: size, height: size }}
        className="flex items-center justify-center bg-white text-[10px] text-red-600"
      >
        QR unavailable
      </div>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Authenticator app setup QR code"
    >
      <rect width={modules} height={modules} fill={light} />
      <path d={path} fill={dark} />
    </svg>
  );
}
