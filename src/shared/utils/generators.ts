import { randomBytes } from 'crypto';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHANUMERIC = UPPER + UPPER.toLowerCase() + '0123456789';

export function generateValidationCode(length = 6): string {
  return Array.from(randomBytes(length))
    .map((byte) => ALPHANUMERIC[byte % ALPHANUMERIC.length])
    .join('');
}

export function generateTemporaryPassword(length = 6): string {
  return generateValidationCode(length);
}
