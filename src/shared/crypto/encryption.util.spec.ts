import { encrypt, decrypt, encryptedTransformer } from './encryption.util';
import * as crypto from 'crypto';

describe('encryption.util', () => {
  const TEST_KEY = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    process.env.DB_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.DB_ENCRYPTION_KEY;
  });

  it('deve cifrar e decifrar corretamente', () => {
    const plaintext = 'Olá, mundo! Dados sensíveis aqui.';
    const encrypted = encrypt(plaintext);
    expect(encrypted).toMatch(/^enc:/);
    expect(encrypted).not.toContain(plaintext);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('deve retornar texto sem cifra quando chave ausente', () => {
    delete process.env.DB_ENCRYPTION_KEY;
    const plaintext = 'Sem cifra';
    expect(encrypt(plaintext)).toBe(plaintext);
    expect(decrypt(plaintext)).toBe(plaintext);
  });

  it('deve retornar null para valores nulos no transformer', () => {
    expect(encryptedTransformer.to(null)).toBeNull();
    expect(encryptedTransformer.from(null)).toBeNull();
  });

  it('deve cifrar via transformer e decifrar corretamente', () => {
    const original = 'CPF: 12345678900';
    const encrypted = encryptedTransformer.to(original);
    expect(encrypted).toMatch(/^enc:/);
    const decrypted = encryptedTransformer.from(encrypted);
    expect(decrypted).toBe(original);
  });

  it('deve gerar cifras diferentes para o mesmo texto (IV aleatório)', () => {
    const text = 'Mesmo texto';
    const a = encrypt(text);
    const b = encrypt(text);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(text);
    expect(decrypt(b)).toBe(text);
  });
});

describe('encryption.util — chave obrigatória em produção', () => {
  const chaveOriginal = process.env.DB_ENCRYPTION_KEY;
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterEach(() => {
    process.env.DB_ENCRYPTION_KEY = chaveOriginal;
    process.env.NODE_ENV = nodeEnvOriginal;
    jest.resetModules();
  });

  it('lanca em producao quando a chave esta ausente', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_ENCRYPTION_KEY = '';
    jest.resetModules();
    const { encrypt } = await import('./encryption.util');

    expect(() => encrypt('dado clinico')).toThrow(/DB_ENCRYPTION_KEY/);
  });

  it('faz round-trip corretamente com chave valida', async () => {
    process.env.DB_ENCRYPTION_KEY = 'a'.repeat(64);
    jest.resetModules();
    const { encrypt, decrypt } = await import('./encryption.util');

    const claro = 'Paciente com fratura de fêmur';
    expect(decrypt(encrypt(claro))).toBe(claro);
  });
});
