import { decodePostgresCa, resolvePostgresSsl } from './postgres-ssl';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';

describe('resolvePostgresSsl', () => {
  it('desliga o TLS quando DB_SSL não é "true"', () => {
    expect(resolvePostgresSsl({})).toBe(false);
    expect(resolvePostgresSsl({ DB_SSL: 'false' })).toBe(false);
    expect(resolvePostgresSsl({ DB_SSL: '' })).toBe(false);
  });

  it('liga o TLS validando o certificado por padrão', () => {
    expect(resolvePostgresSsl({ DB_SSL: 'true' })).toEqual({
      rejectUnauthorized: true,
    });
    expect(
      resolvePostgresSsl({ DB_SSL: 'TRUE', DB_SSL_REJECT_UNAUTHORIZED: '' }),
    ).toEqual({ rejectUnauthorized: true });
  });

  it('só desliga a validação com DB_SSL_REJECT_UNAUTHORIZED=false explícito', () => {
    expect(
      resolvePostgresSsl({
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false',
      }),
    ).toEqual({ rejectUnauthorized: false });
    expect(
      resolvePostgresSsl({ DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'no' }),
    ).toEqual({ rejectUnauthorized: true });
  });

  it('anexa a CA informada em PEM', () => {
    expect(resolvePostgresSsl({ DB_SSL: 'true', DB_SSL_CA: PEM })).toEqual({
      rejectUnauthorized: true,
      ca: PEM,
    });
  });

  it('ignora DB_SSL_CA quando o TLS está desligado', () => {
    expect(resolvePostgresSsl({ DB_SSL_CA: 'lixo' })).toBe(false);
  });
});

describe('decodePostgresCa', () => {
  it('devolve undefined para valor vazio', () => {
    expect(decodePostgresCa(undefined)).toBeUndefined();
    expect(decodePostgresCa('  ')).toBeUndefined();
  });

  it('converte \\n literal de uma linha só em quebra de linha', () => {
    const oneLine = PEM.replace(/\n/g, '\\n');
    expect(decodePostgresCa(oneLine)).toBe(PEM);
  });

  it('decodifica PEM em base64', () => {
    const encoded = Buffer.from(PEM, 'utf8').toString('base64');
    expect(decodePostgresCa(encoded)).toBe(PEM);
  });

  it('recusa conteúdo que não é certificado', () => {
    const encoded = Buffer.from('não é pem', 'utf8').toString('base64');
    expect(() => decodePostgresCa(encoded)).toThrow('DB_SSL_CA inválido');
  });
});
