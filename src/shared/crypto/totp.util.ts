import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  while (output.length % 8 !== 0) {
    output += '=';
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Base32 inválido');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES)).replace(/=+$/, '');
}

export function totpStepAt(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function hotp(
  key: Buffer,
  counter: number,
  digits: number = TOTP_DIGITS,
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function generateTotp(
  secretBase32: string,
  nowMs: number = Date.now(),
): string {
  return hotp(base32Decode(secretBase32), totpStepAt(nowMs));
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function normalizeTotpCode(code: string): string {
  return (code ?? '').replace(/\s+/g, '');
}

export function isTotpFormat(code: string): boolean {
  return /^\d{6}$/.test(normalizeTotpCode(code));
}

export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
  window: number = TOTP_WINDOW,
): number | null {
  const normalized = normalizeTotpCode(code);
  if (!isTotpFormat(normalized)) return null;
  const key = base32Decode(secretBase32);
  const current = totpStepAt(nowMs);
  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (step < 0) continue;
    if (safeEqual(hotp(key, step), normalized) && matched === null) {
      matched = step;
    }
  }
  return matched;
}

export function buildOtpauthUri(
  secretBase32: string,
  accountName: string,
  issuer: string,
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
