import * as crypto from 'crypto';

export function hashPhone(phone: string): string {
  const salt = process.env.PHONE_HASH_SALT;
  if (!salt) {
    throw new Error('PHONE_HASH_SALT não configurado — impossível continuar.');
  }
  return crypto.createHmac('sha256', salt).update(phone).digest('hex');
}
