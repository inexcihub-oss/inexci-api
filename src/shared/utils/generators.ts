import { randomBytes } from 'crypto';

const DIGITS = '0123456789';

export function generateValidationCode(length = 6): string {
  return Array.from(randomBytes(length))
    .map((byte) => DIGITS[byte % DIGITS.length])
    .join('');
}

export function generateTemporaryPassword(length = 6): string {
  return generateValidationCode(length);
}
