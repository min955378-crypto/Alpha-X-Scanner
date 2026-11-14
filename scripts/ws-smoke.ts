import WebSocket from 'ws';

const COOKIE = process.argv[2] ?? '';
const ws = new WebSocket('ws://127.0.0.1:3000/ws/market', COOKIE ? { headers: { cookie: COOKIE } } : undefined);
const seen: Record<string, number> = {};
let frameCoins = 0;
let tickUpdates = 0;

ws.on('open', () => {
  console.log('WS open');
  ws.send(JSON.stringify({ type: 'subscribe', timeframe: '1H', scanners: ['v1-scaling', 'alpha-sniper'] }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  seen[msg.type] = (seen[msg.type] ?? 0) + 1;
  if (msg.type === 'hello') console.log('hello:', msg.dataMode, msg.boot);
  if (msg.type === 'frame') {
    frameCoins = msg.frame.coins.length;
    console.log('frame: coins', frameCoins, 'tf', msg.frame.timeframe, 'cycle', msg.frame.cycle,
      'zones', msg.frame.counts.zones, 'sentiment', msg.frame.sentiment.label,
      'spotlight', msg.frame.spotlight?.baseAsset ?? null);
  }
  if (msg.type === 'tick') tickUpdates += msg.u.length;
  if (msg.type === 'signals') console.log('signals:', msg.scannerSlug, msg.signals.length);
  if (msg.type === 'boot') process.stdout.write('.');
});

ws.on('error', (e) => console.error('WS error', e.message));
ws.on('close', () => console.log('WS closed'));

setTimeout(() => {
  console.log('\nmessage counts:', seen, 'total tick rows:', tickUpdates);
  process.exit(0);
}, 9000);
