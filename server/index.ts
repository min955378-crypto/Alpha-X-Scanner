import { createServer } from 'node:http';
import { parse } from 'node:url';

import next from 'next';

import { getEngine } from './engine';
import { wireEngineBroadcast, handleUpgrade } from './ws';

/**
 * Custom Next.js server.
 *
 * One process, one port, one origin:
 *   • HTTP  -> Next.js App Router (pages + route handlers)
 *   • WSS   -> /ws/market, the 1 Hz / 60 s market data plane
 *
 * The Global Quant Worker boots eagerly at startup so the very first page load
 * already has a warm, seeded universe.
 */

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = Number(process.env.PORT || 3000);

async function main(): Promise<void> {
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    void handle(req, res, parse(req.url || '/', true));
  });

  server.on('upgrade', (req, socket, head) => {
    // Market traffic is ours; everything else (webpack HMR in dev) stays Next's.
    if (handleUpgrade(req, socket, head)) return;
    void upgradeHandler(req, socket, head);
  });

  wireEngineBroadcast();

  server.listen(port, hostname, () => {
    console.log(`\n  ▲ ScalpPro v2 ready on http://${hostname}:${port}`);
    console.log(`  ▸ WebSocket data plane:  /ws/market`);
    void getEngine().start().then(() => {
      console.log(`  ▸ Quant worker online in ${getEngine().dataMode} mode\n`);
    });
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
