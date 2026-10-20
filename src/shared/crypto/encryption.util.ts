import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
export const ENCRYPTED_PREFIX = 'enc:';

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
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DB_ENCRYPTION_KEY ausente: recusando gravar dado sensível em texto claro',
      );
    }
    return plaintext;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(value: string): string {
  if (!value?.startsWith(ENCRYPTED_PREFIX)) return value;

  const key = getKey();
  if (!key) return value;

  const parts = value.split(':');
  if (parts.length !== 4) return value;

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const encrypted = Buffer.from(parts[3], 'base64');

  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Valor cifrado inválido: IV ou tag de autenticação');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export const encryptedTransformer = {
  to: (value: string | null): string | null => (value ? encrypt(value) : value),
  from: (value: string | null): string | null =>
    value ? decrypt(value) : value,
};

export function hasEncryptionKey(): boolean {
  return getKey() !== null;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith(ENCRYPTED_PREFIX);
}
