import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';
import './globals.css';

/** §1.1  Document title is [LIVE-VERIFIED]: "ScalpPro v2 — Login". */
export const metadata: Metadata = {
  title: 'ScalpPro v2 — Login',
  description: 'Smart Binance Coin Finder — RSI Heatmap, 5 scanners and Binance Risk Watch on one terminal.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A0C14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* §3.1  Google Fonts: Inter + IBM Plex Sans (UI), JetBrains Mono (numbers),
            Noto Nastaliq Urdu (disclaimers & glossary). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* §13  overflow-x-clip (never hidden) keeps the sticky top bar reliable. */}
      <body className="min-h-screen bg-bg-canvas text-white antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
