import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer | null {
  const key = process.env.DB_ENCRYPTION_KEY;
  if (!key) return null;
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) {
    throw new Error(
      'DB_ENCRYPTION_KEY deve ser exatamente 32 bytes (64 chars hex)',
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // iv:tag:ciphertext em base64
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(value: string): string {
  if (!value?.startsWith('enc:')) return value;

  const key = getKey();
  if (!key) return value;

  const parts = value.split(':');
  if (parts.length !== 4) return value;

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const encrypted = Buffer.from(parts[3], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * ValueTransformer para TypeORM — cifra ao salvar, decifra ao ler.
 * Só ativa se DB_ENCRYPTION_KEY estiver definida.
 */
export const encryptedTransformer = {
  to: (value: string | null): string | null => (value ? encrypt(value) : value),
  from: (value: string | null): string | null =>
    value ? decrypt(value) : value,
};
