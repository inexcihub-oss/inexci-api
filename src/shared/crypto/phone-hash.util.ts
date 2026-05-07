import * as crypto from 'crypto';

/**
 * Hash determinístico de phone para indexação e lookup seguro.
 * Usa HMAC-SHA256 com salt da env para evitar rainbow table.
 * Retorna string hex de 64 chars.
 */
export function hashPhone(phone: string): string {
  const salt = process.env.PHONE_HASH_SALT || 'inexci-default-salt';
  return crypto.createHmac('sha256', salt).update(phone).digest('hex');
}
