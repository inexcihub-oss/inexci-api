import {
  encrypt,
  decrypt,
  encryptedTransformer,
  hasEncryptionKey,
  isEncrypted,
} from './encryption.util';
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

describe('encryption.util — integridade do GCM', () => {
  const TEST_KEY = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    process.env.DB_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.DB_ENCRYPTION_KEY;
  });

  function partes(valor: string) {
    const [prefixo, iv, tag, dados] = valor.split(':');
    return { prefixo, iv, tag, dados };
  }

  it('grava tag de 16 bytes', () => {
    const { tag } = partes(encrypt('texto'));
    expect(Buffer.from(tag, 'base64')).toHaveLength(16);
  });

  it('recusa tag truncada', () => {
    const { iv, tag, dados } = partes(encrypt('texto'));
    const truncada = Buffer.from(tag, 'base64')
      .subarray(0, 4)
      .toString('base64');
    expect(() => decrypt(`enc:${iv}:${truncada}:${dados}`)).toThrow(
      /tag de autenticação/,
    );
  });

  it('recusa IV de tamanho errado', () => {
    const { tag, dados } = partes(encrypt('texto'));
    const iv = crypto.randomBytes(16).toString('base64');
    expect(() => decrypt(`enc:${iv}:${tag}:${dados}`)).toThrow();
  });

  it('recusa conteúdo adulterado', () => {
    const { iv, tag, dados } = partes(encrypt('texto original'));
    const bytes = Buffer.from(dados, 'base64');
    bytes[0] ^= 0xff;
    expect(() =>
      decrypt(`enc:${iv}:${tag}:${bytes.toString('base64')}`),
    ).toThrow();
  });

  it('transformer devolve texto legado (não cifrado) como está', () => {
    expect(encryptedTransformer.from('Anotação antiga')).toBe(
      'Anotação antiga',
    );
  });

  it('isEncrypted e hasEncryptionKey', () => {
    expect(isEncrypted(encrypt('x'))).toBe(true);
    expect(isEncrypted('x')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(hasEncryptionKey()).toBe(true);
    delete process.env.DB_ENCRYPTION_KEY;
    expect(hasEncryptionKey()).toBe(false);
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
