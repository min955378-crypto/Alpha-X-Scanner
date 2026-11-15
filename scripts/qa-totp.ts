/**
 * §2.2  TOTP regression suite.
 *
 * The authenticator engine is the only piece of new cryptography in the admin
 * login path, so it is verified against the published RFC 6238 test vectors
 * rather than round-tripping through itself (a self-consistent implementation
 * can still be wrong, and a wrong one locks the owner out of /admin).
 *
 * Run with `npm run qa:totp`.
 */

import { strict as assert } from 'node:assert';

import {
  base32Decode,
  base32Encode,
  formatSecretForDisplay,
  generateTotpSecret,
  hotp,
  totpCode,
  totpCounter,
  totpSecondsRemaining,
  totpUri,
  verifyTotp,
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
} from '@/server/engine/totp';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n')[0]}`);
  }
}

/* RFC 6238 Appendix B seed: the ASCII string "12345678901234567890". */
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'));

console.log('\n§2.2.1  RFC 6238 published test vectors (HMAC-SHA1)');
/**
 * The RFC lists 8-digit HOTP values. Our engine emits 6 digits, which is the
 * low-order 6 digits of the same truncated value.
 */
const RFC_VECTORS: Array<{ time: number; eightDigit: string }> = [
  { time: 59, eightDigit: '94287082' },
  { time: 1111111109, eightDigit: '07081804' },
  { time: 1111111111, eightDigit: '14050471' },
  { time: 1234567890, eightDigit: '89005924' },
  { time: 2000000000, eightDigit: '69279037' },
  { time: 20000000000, eightDigit: '65353130' },
];

for (const v of RFC_VECTORS) {
  check(`T=${v.time} → ${v.eightDigit.slice(2)}`, () => {
    const expected = v.eightDigit.slice(2);
    const counter = totpCounter(v.time * 1000);
    assert.equal(hotp(RFC_SECRET_BASE32, counter), expected);
  });
}

console.log('\n§2.2.2  Base32 codec');
check('base32 round-trips arbitrary bytes', () => {
  for (let n = 1; n <= 40; n += 1) {
    const buf = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff));
    assert.equal(base32Decode(base32Encode(buf)).toString('hex'), buf.toString('hex'));
  }
});
check('RFC seed encodes to the expected base32', () => {
  assert.equal(RFC_SECRET_BASE32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});
check('decode tolerates lower case, spaces and padding', () => {
  const spaced = base32Encode(Buffer.from('alpha-x-scanner'))
    .toLowerCase()
    .match(/.{1,4}/g)!
    .join(' ');
  assert.equal(base32Decode(spaced).toString('utf8'), 'alpha-x-scanner');
  assert.equal(base32Decode(`${base32Encode(Buffer.from('abc'))}====`).toString('utf8'), 'abc');
});
check('decode rejects a non-alphabet character', () => {
  assert.throws(() => base32Decode('ABC1!XYZ'), /INVALID_BASE32/);
});
check('display formatting groups without altering the secret', () => {
  const secret = generateTotpSecret();
  const shown = formatSecretForDisplay(secret);
  assert.match(shown, /^[A-Z2-7 ]+$/);
  assert.equal(base32Decode(shown).toString('hex'), base32Decode(secret).toString('hex'));
});

console.log('\n§2.2.3  Codes and the drift window');
check('code is always 6 digits', () => {
  const secret = generateTotpSecret();
  for (let i = 0; i < 200; i += 1) {
    assert.match(totpCode(secret, Date.now() + i * 997), /^\d{6}$/);
  }
});
check('code is stable within a step and rotates across it', () => {
  const secret = generateTotpSecret();
  const base = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) * TOTP_STEP_SECONDS * 1000;
  const atStart = totpCode(secret, base);
  assert.equal(totpCode(secret, base + 29_000), atStart);
  assert.notEqual(totpCode(secret, base + (TOTP_STEP_SECONDS + 1) * 1000), atStart);
});
check('current code verifies', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  assert.equal(verifyTotp(secret, totpCode(secret, now), { now }).ok, true);
});
check('previous and next step are accepted (clock drift)', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const prev = totpCode(secret, now - TOTP_STEP_SECONDS * 1000);
  const next = totpCode(secret, now + TOTP_STEP_SECONDS * 1000);
  assert.equal(verifyTotp(secret, prev, { now }).ok, true, 'previous step rejected');
  assert.equal(verifyTotp(secret, next, { now }).ok, true, 'next step rejected');
});
check('a code from two steps away is rejected', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const stale = totpCode(secret, now - 2 * TOTP_STEP_SECONDS * 1000 - 500);
  assert.equal(verifyTotp(secret, stale, { now }).ok, false);
});
check('a wrong code is rejected', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const wrong = String((Number(totpCode(secret, now)) + 1) % 1_000_000).padStart(6, '0');
  assert.equal(verifyTotp(secret, wrong, { now }).ok, false);
});
check('malformed input is rejected, not thrown', () => {
  const secret = generateTotpSecret();
  for (const bad of ['', '12345', 'abcdef', '1234567', '12 34', '!!!!!!']) {
    assert.equal(verifyTotp(secret, bad, { now: Date.now() }).ok, false, `accepted ${JSON.stringify(bad)}`);
  }
});
check('an invalid stored secret fails closed', () => {
  assert.equal(verifyTotp('', '123456').ok, false);
  assert.equal(verifyTotp('not-base32!!', '123456').ok, false);
});
check('replay of a spent step is refused', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const prevCounter = totpCounter(now - TOTP_STEP_SECONDS * 1000);
  const prevCode = totpCode(secret, now - TOTP_STEP_SECONDS * 1000);
  /* lastCounter === current step still admits the drift window, but a code
     from a step at or before lastCounter is spent. */
  assert.equal(verifyTotp(secret, prevCode, { now, lastCounter: prevCounter }).ok, false);
  assert.equal(verifyTotp(secret, totpCode(secret, now), { now, lastCounter: prevCounter }).ok, true);
});
check('seconds remaining stays inside the step', () => {
  for (let i = 0; i < 100; i += 1) {
    const r = totpSecondsRemaining(Date.now() + i * 317);
    assert.ok(r >= 1 && r <= TOTP_STEP_SECONDS, `remaining ${r}`);
  }
});

console.log('\n§2.2.4  otpauth:// provisioning URI');
check('URI carries every field authenticator apps read', () => {
  const secret = generateTotpSecret();
  const uri = totpUri({ secret, accountName: 'admin' });
  assert.match(uri, /^otpauth:\/\/totp\//);
  const parsed = new URL(uri.replace('otpauth://', 'https://'));
  assert.equal(parsed.searchParams.get('secret'), secret);
  assert.equal(parsed.searchParams.get('issuer'), 'Alpha X Scanner');
  assert.equal(parsed.searchParams.get('algorithm'), 'SHA1');
  assert.equal(parsed.searchParams.get('digits'), String(TOTP_DIGITS));
  assert.equal(parsed.searchParams.get('period'), String(TOTP_STEP_SECONDS));
  assert.ok(decodeURIComponent(parsed.pathname).endsWith('Alpha X Scanner:admin'));
});
check('account name is percent-encoded', () => {
  const uri = totpUri({ secret: 'JBSWY3DPEHPK3PXP', accountName: 'muhammad ibrahim/admin' });
  assert.ok(!uri.includes(' '), 'URI must not contain a raw space');
});

console.log('\n§2.2.5  Secret generation');
check('generated secrets are 160-bit and unique', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const s = generateTotpSecret();
    assert.match(s, /^[A-Z2-7]{32}$/);
    assert.equal(base32Decode(s).length, 20);
    seen.add(s);
  }
  assert.equal(seen.size, 500);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
