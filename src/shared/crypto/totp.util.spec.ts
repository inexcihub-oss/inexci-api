import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotp,
  generateTotpSecret,
  hotp,
  totpStepAt,
  verifyTotp,
} from './totp.util';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_B32 = base32Encode(RFC_SECRET);

describe('base32 (RFC 4648)', () => {
  it.each([
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======'],
  ])('codifica %p como %p', (raw, encoded) => {
    expect(base32Encode(Buffer.from(raw))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(raw);
  });

  it('decodifica sem padding, minúsculas e com espaços', () => {
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
  });

  it('rejeita caractere fora do alfabeto', () => {
    expect(() => base32Decode('MZ1W')).toThrow();
  });
});

describe('HOTP (RFC 4226)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [9, '520489'],
  ])('contador %p gera %p', (counter, expected) => {
    expect(hotp(RFC_SECRET, counter)).toBe(expected);
  });
});

describe('TOTP (RFC 6238, SHA1)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('T=%p gera os 6 últimos dígitos de %p', (seconds, eightDigits) => {
    expect(hotp(RFC_SECRET, totpStepAt(seconds * 1000), 8)).toBe(eightDigits);
    expect(generateTotp(RFC_SECRET_B32, seconds * 1000)).toBe(
      eightDigits.slice(2),
    );
  });

  it('aceita o passo atual e devolve o passo casado', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET_B32, now);
    expect(verifyTotp(RFC_SECRET_B32, code, now)).toBe(totpStepAt(now));
  });

  it('aceita um passo antes e um depois (janela ±1)', () => {
    const now = 1_700_000_000_000;
    const anterior = generateTotp(RFC_SECRET_B32, now - 30_000);
    const seguinte = generateTotp(RFC_SECRET_B32, now + 30_000);
    expect(verifyTotp(RFC_SECRET_B32, anterior, now)).toBe(totpStepAt(now) - 1);
    expect(verifyTotp(RFC_SECRET_B32, seguinte, now)).toBe(totpStepAt(now) + 1);
  });

  it('recusa código fora da janela', () => {
    const now = 1_700_000_000_000;
    const velho = generateTotp(RFC_SECRET_B32, now - 90_000);
    expect(verifyTotp(RFC_SECRET_B32, velho, now)).toBeNull();
  });

  it('recusa formato inválido', () => {
    expect(verifyTotp(RFC_SECRET_B32, 'abc123')).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, '12345')).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, '')).toBeNull();
  });

  it('tolera espaços no código', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET_B32, now);
    expect(
      verifyTotp(RFC_SECRET_B32, `${code.slice(0, 3)} ${code.slice(3)}`, now),
    ).not.toBeNull();
  });
});

describe('generateTotpSecret', () => {
  it('gera 160 bits em base32 sem padding e diferente a cada chamada', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(a).not.toBe(b);
  });
});

describe('buildOtpauthUri', () => {
  it('monta a URI com issuer, conta e parâmetros do TOTP', () => {
    const uri = buildOtpauthUri('ABC', 'dr+ana@x.com', 'Inexci');
    expect(uri.startsWith('otpauth://totp/Inexci:dr%2Bana%40x.com?')).toBe(
      true,
    );
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('ABC');
    expect(params.get('issuer')).toBe('Inexci');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
    expect(params.get('algorithm')).toBe('SHA1');
  });
});
