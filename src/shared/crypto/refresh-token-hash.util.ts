import * as crypto from 'crypto';

/**
 * Hash SHA-256 (hex) do refresh token cru.
 *
 * O token é um uuid v4 (~122 bits de entropia), então não há risco prático de
 * brute-force/rainbow-table — SHA-256 sem salt é suficiente e determinístico
 * (permite lookup direto por hash no Redis). Nunca persistimos o valor cru.
 */
export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
