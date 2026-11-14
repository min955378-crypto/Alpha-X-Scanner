import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

import { encodeFrame, type WireFrame } from '@/lib/wire';
import { SCANNER_BY_SLUG, type ClientMessage, type EntitlementKey, type ScannerSlug, type ServerMessage, type Timeframe } from '@/lib/types';
import { getEngine } from './engine';
import { getDb, type UserRecord } from './engine/db';
import { parseCookies, sessionUserFromToken, SESSION_COOKIE } from './engine/auth';

/**
 * §2.1  WebSocket data plane at `/ws/market`.
 *
 * Served by the SAME HTTP server as Next.js so the browser only ever talks to
 * one origin — no second port, no localhost calls from client code, and the
 * `wss://` upgrade survives the Cloudflare edge proxy.
 */

interface Client {
  socket: WebSocket;
  userId: string | null;
  entitlements: Record<EntitlementKey, boolean>;
  timeframe: Timeframe;
  scanners: Set<ScannerSlug>;
  isAdmin: boolean;
}

const clients = new Set<Client>();
let wss: WebSocketServer | null = null;

export function createWsServer(): WebSocketServer {
  if (!wss) {
    wss = new WebSocketServer({
      noServer: true,
      // 612-coin frames compress ~6× with permessage-deflate.
      perMessageDeflate: { threshold: 1024 },
      maxPayload: 8 * 1024 * 1024,
    });
    wss.on('connection', onConnection);
  }
  return wss;
}

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = req.url ?? '';
  if (!url.startsWith('/ws/market')) return false;
  const server = createWsServer();
  server.handleUpgrade(req, socket, head, (ws) => server.emit('connection', ws, req));
  return true;
}

export function wsClientCount(): number {
  return clients.size;
}

type Outbound = Exclude<ServerMessage, { type: 'frame' }> | { type: 'frame'; frame: WireFrame };

function send(client: Client, msg: Outbound): void {
  if (client.socket.readyState !== client.socket.OPEN) return;
  try {
    client.socket.send(JSON.stringify(msg));
  } catch {
    /* Client vanished mid-send. */
  }
}

function onConnection(socket: WebSocket, req: IncomingMessage): void {
  const engine = getEngine();
  const db = getDb();
  const cookies = parseCookies(req.headers.cookie);
  const sessionUser = sessionUserFromToken(cookies[SESSION_COOKIE]);
  const record: UserRecord | undefined = sessionUser ? db.userById(sessionUser.id) : undefined;

  const client: Client = {
    socket,
    userId: sessionUser?.id ?? null,
    entitlements: sessionUser?.entitlements ?? ({} as Record<EntitlementKey, boolean>),
    timeframe: sessionUser?.preferredTimeframe ?? '1H',
    scanners: new Set(),
    isAdmin: sessionUser?.role === 'ADMIN',
  };

  // Unauthenticated sockets still get public market data; scanner channels stay
  // gated by entitlement.
  for (const s of Object.values(SCANNER_BY_SLUG)) {
    if (client.entitlements[s.entitlementKey]) client.scanners.add(s.slug);
  }

  clients.add(client);
  engine.wsClients = clients.size;
  engine.requestTimeframe(client.timeframe);

  send(client, {
    type: 'hello',
    t: Date.now(),
    dataMode: engine.dataMode,
    boot: engine.boot,
    timeframe: client.timeframe,
  });

  const frame = engine.getFrame(client.timeframe);
  if (frame) send(client, { type: 'frame', frame: encodeFrame(frame) });

  for (const slug of client.scanners) {
    send(client, { type: 'signals', scannerSlug: slug, signals: engine.getSignals(slug) });
  }

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      send(client, { type: 'pong', t: Date.now() });
      return;
    }

    if (msg.type === 'subscribe') {
      if (msg.timeframe) {
        client.timeframe = msg.timeframe;
        engine.requestTimeframe(msg.timeframe);
        const f = engine.getFrame(msg.timeframe);
        if (f) send(client, { type: 'frame', frame: encodeFrame(f) });
      }
      for (const slug of msg.scanners ?? []) {
        if (client.entitlements[SCANNER_BY_SLUG[slug].entitlementKey]) {
          client.scanners.add(slug);
          send(client, { type: 'signals', scannerSlug: slug, signals: engine.getSignals(slug) });
        }
      }
      return;
    }

    if (msg.type === 'unsubscribe') {
      for (const slug of msg.scanners ?? []) client.scanners.delete(slug);
      return;
    }

    if (msg.type === 'scan-now') {
      if (!client.entitlements[SCANNER_BY_SLUG[msg.scannerSlug].entitlementKey]) return;
      engine.scanNow(msg.scannerSlug);
    }
  });

  socket.on('close', () => {
    clients.delete(client);
    engine.wsClients = clients.size;
  });

  socket.on('error', () => {
    clients.delete(client);
    engine.wsClients = clients.size;
  });
}

/* ------------------------------- fan-out ---------------------------------- */

let hooked = false;

export function wireEngineBroadcast(): void {
  if (hooked) return;
  hooked = true;
  const engine = getEngine();

  engine.addListener((msg) => {
    for (const client of clients) {
      if (msg.type === 'signals' && !client.scanners.has(msg.scannerSlug)) continue;
      if (msg.type === 'frame') {
        if (msg.frame.timeframe !== client.timeframe) continue;
        // Encode once per fan-out, not once per client.
        const encoded: Outbound = { type: 'frame', frame: encodeFrame(msg.frame) };
        send(client, encoded);
        continue;
      }
      send(client, msg as Outbound);
    }
  });
}

/** §10 module 2 — push an ACCESS_UPDATED event when entitlements change. */
export function pushAccessUpdate(userId: string): void {
  const db = getDb();
  const u = db.userById(userId);
  if (!u) return;
  const entitlements = db.entitlementsOf(u);
  for (const client of clients) {
    if (client.userId !== userId) continue;
    client.entitlements = entitlements;
    client.scanners = new Set(
      Object.values(SCANNER_BY_SLUG)
        .filter((s) => entitlements[s.entitlementKey])
        .map((s) => s.slug),
    );
    send(client, { type: 'access', entitlements });
    for (const slug of client.scanners) {
      send(client, { type: 'signals', scannerSlug: slug, signals: getEngine().getSignals(slug) });
    }
  }
}

/** §10 module 7 — live announcement toast to every connected client. */
export function pushBroadcast(title: string, body: string, level: 'info' | 'warn' = 'info'): void {
  for (const client of clients) send(client, { type: 'broadcast', title, body, level });
}
