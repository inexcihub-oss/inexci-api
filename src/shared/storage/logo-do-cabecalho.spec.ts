import {
  caminhoDoLogoDoCabecalho,
  chaveDaUrlDoBucket,
} from './logo-do-cabecalho';

describe('chaveDaUrlDoBucket', () => {
  it('extrai a chave de URL path-style do nosso bucket', () => {
    expect(
      chaveDaUrlDoBucket(
        'https://conta.r2.cloudflarestorage.com/inexci/headers/o1/a.png?X-Amz-Signature=1',
        'inexci',
      ),
    ).toBe('headers/o1/a.png');
  });

  it('extrai a chave de URL virtual-host do nosso bucket', () => {
    expect(
      chaveDaUrlDoBucket(
        'https://inexci.conta.r2.cloudflarestorage.com/headers/o1/a.png',
        'inexci',
      ),
    ).toBe('headers/o1/a.png');
  });

  it.each([
    [
      'outro bucket',
      'https://conta.r2.cloudflarestorage.com/outro/headers/o1/a.png',
    ],
    ['outro host', 'https://evil.example.com/inexci/headers/o1/a.png'],
    [
      'http sem TLS',
      'http://conta.r2.cloudflarestorage.com/inexci/headers/o1/a.png',
    ],
    ['URL inválida', 'https://'],
  ])('recusa %s', (_, url) => {
    expect(chaveDaUrlDoBucket(url, 'inexci')).toBeNull();
  });

  it('recusa quando o bucket não é conhecido', () => {
    expect(
      chaveDaUrlDoBucket(
        'https://conta.r2.cloudflarestorage.com/inexci/headers/o1/a.png',
        undefined,
      ),
    ).toBeNull();
  });
});

describe('caminhoDoLogoDoCabecalho', () => {
  it('aceita caminho da pasta de cabeçalhos da conta', () => {
    expect(
      caminhoDoLogoDoCabecalho('headers/o1/a.png', { ownerId: 'o1' }),
    ).toBe('headers/o1/a.png');
  });

  it('recusa caminho de outra conta', () => {
    expect(
      caminhoDoLogoDoCabecalho('headers/o2/a.png', { ownerId: 'o1' }),
    ).toBeNull();
  });

  it('recusa outra pasta e travessia', () => {
    expect(
      caminhoDoLogoDoCabecalho('documents/o1/a.pdf', { ownerId: 'o1' }),
    ).toBeNull();
    expect(
      caminhoDoLogoDoCabecalho('headers/o1/../o2/a.png', { ownerId: 'o1' }),
    ).toBeNull();
  });

  it('converte URL legada do nosso bucket em caminho, conferindo a conta', () => {
    const url =
      'https://conta.r2.cloudflarestorage.com/inexci/headers/o1/a.png';
    expect(
      caminhoDoLogoDoCabecalho(url, { bucket: 'inexci', ownerId: 'o1' }),
    ).toBe('headers/o1/a.png');
    expect(
      caminhoDoLogoDoCabecalho(url, { bucket: 'inexci', ownerId: 'o2' }),
    ).toBeNull();
  });

  it('recusa URL externa', () => {
    expect(
      caminhoDoLogoDoCabecalho('https://169.254.169.254/latest', {
        bucket: 'inexci',
        ownerId: 'o1',
      }),
    ).toBeNull();
  });

  it('sem ownerId exige ao menos a pasta de cabeçalhos', () => {
    expect(caminhoDoLogoDoCabecalho('headers/o1/a.png', {})).toBe(
      'headers/o1/a.png',
    );
    expect(caminhoDoLogoDoCabecalho('signatures/o1/a.png', {})).toBeNull();
  });
});
