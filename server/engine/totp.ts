import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * §2.2  RFC 6238 TOTP authenticator engine.
 *
 * Zero external dependencies and zero network calls — everything is done with
 * Node's native `node:crypto`, so it works identically on a long-lived server
 * and on a Vercel serverless invocation, and it is compatible with Google
 * Authenticator, Authy and Microsoft Authenticator.
 *
 * Parameters are the ones every authenticator app assumes by default:
 *   • HMAC-SHA1
 *   • 30-second time step
 *   • 6 digits
 *   • T0 = Unix epoch
 */

/** RFC 4648 base32 alphabet — no padding, upper case. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const STEP_SECONDS = 30;
const DIGITS = 6;

/** Seconds of clock drift tolerated either side of "now" (window ±1 step). */
export const TOTP_WINDOW_STEPS = 1;

export function base32Encode(input: Buffer): string {
  /* Built from an explicit bit string rather than a shifting integer
     accumulator. The accumulator has to be masked on every step to stay inside
     int32, and getting that masking subtly wrong silently corrupts long inputs
     while still producing correct output for the 20-byte case — which is
     exactly the failure mode that is hardest to notice. Secrets are tens of
     bytes, so the string cost is irrelevant next to being obviously correct. */
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');

  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

/**
 * Decodes base32. Tolerant of the things humans and authenticator apps do to a
 * setup key: lower case, spaces (usually inserted for readability in groups of
 * four), trailing `=` padding and the easily-confused `0/O` and `1/I/L` pairs.
 */
export function base32Decode(input: string): Buffer {
  /*
   * Normalise only characters that CANNOT legally appear in base32.
   *
   * The alphabet is A–Z plus 2–7, so `0` and `1` are always typos and are
   * safe to fold onto their usual look-alikes (`O` and `L`). It is tempting to
   * also fold `I` onto `L`, but `I` is a genuine base32 character (index 8) —
   * doing so silently corrupted every secret containing one, which is how this
   * bug reached the codec in the first place.
   */
  const cleaned = input
    .toUpperCase()
    .replace(/[\s=]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'L');

  let bits = '';
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('INVALID_BASE32');
    bits += idx.toString(2).padStart(5, '0');
  }

  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    out.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(out);
}

/**
 * Mints a fresh secret. 20 bytes (160 bits) is what Google Authenticator
 * expects; anything shorter is rejected by some apps.
 */
export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

/** The TOTP time-step counter for a given instant. */
export function totpCounter(now: number = Date.now(), step = STEP_SECONDS): number {
  return Math.floor(now / 1000 / step);
}

/**
 * HOTP (RFC 4226): HMAC-SHA1 of the 64-bit counter, then dynamic truncation.
 * Exported for the unit tests; applications want `totpCode` below.
 */
export function hotp(secretBase32: string, counter: number, digits = DIGITS): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const mac = createHmac('sha1', key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const truncated =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return String(truncated % 10 ** digits).padStart(digits, '0');
}

/** The 6-digit code currently displayed by the user's authenticator app. */
export function totpCode(secretBase32: string, now: number = Date.now()): string {
  return hotp(secretBase32, totpCounter(now));
}

/** Seconds left before the current code rotates. */
export function totpSecondsRemaining(now: number = Date.now(), step = STEP_SECONDS): number {
  return step - (Math.floor(now / 1000) % step);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Validates a user-supplied code.
 *
 * Checks the previous, current and next step so a phone whose clock is a few
 * seconds out never produces a false rejection. `lastCounter`, when supplied,
 * rejects a code that was already used in that step (replay protection).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { now?: number; window?: number; lastCounter?: number } = {},
): { ok: boolean; counter?: number } {
  const { now = Date.now(), window = TOTP_WINDOW_STEPS, lastCounter } = options;
  const candidate = code.replace(/\D/g, '');
  if (candidate.length !== DIGITS || !secretBase32) return { ok: false };

  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    return { ok: false };
  }
  if (key.length === 0) return { ok: false };

  const current = totpCounter(now);
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = current + delta;
    /* A replayed code from a step the user has already spent is refused even
       though it still falls inside the drift window. */
    if (lastCounter !== undefined && counter <= lastCounter) continue;
    if (constantTimeEquals(hotp(secretBase32, counter), candidate)) {
      return { ok: true, counter };
    }
  }
  return { ok: false };
}

/**
 * Builds the `otpauth://` URI the QR code encodes. Every field here is read by
 * the authenticator app, so the issuer must match the brand exactly.
 */
export function totpUri(input: {
  secret: string;
  accountName: string;
  issuer?: string;
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
  digits?: number;
  period?: number;
}): string {
  const {
    secret,
    accountName,
    issuer = 'Alpha X Scanner',
    algorithm = 'SHA1',
    digits = DIGITS,
    period = STEP_SECONDS,
  } = input;
  const label = `${issuer}:${accountName}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/** `JBSWY3DP EHPK3PXP ...` — grouped for a human reading it off the screen. */
export function formatSecretForDisplay(secret: string, group = 4): string {
  return secret.replace(/[\s=]/g, '').match(new RegExp(`.{1,${group}}`, 'g'))?.join(' ') ?? secret;
}

export { DIGITS as TOTP_DIGITS, STEP_SECONDS as TOTP_STEP_SECONDS };
