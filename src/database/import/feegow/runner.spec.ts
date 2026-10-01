import { assertBancoPermitido, interpretarArgumentos } from './runner';

describe('interpretarArgumentos', () => {
  const base = [
    '--dir',
    '/x',
    '--fase',
    'cadastro',
    '--owner-email',
    'Dono@X.com',
  ];

  it('lê o básico e normaliza o e-mail', () => {
    const o = interpretarArgumentos(base);
    expect(o).toMatchObject({
      dir: '/x',
      fase: 'cadastro',
      ownerEmail: 'dono@x.com',
      dryRun: false,
      out: '/x',
      confirmar: true,
    });
  });

  it('--sem-banco implica dry-run e dispensa o e-mail do dono', () => {
    const o = interpretarArgumentos([
      '--dir',
      '/x',
      '--fase',
      'cadastro',
      '--sem-banco',
    ]);
    expect(o.dryRun).toBe(true);
    expect(o.ownerEmail).toBeNull();
  });

  it('exige o e-mail do dono quando vai usar o banco', () => {
    expect(() =>
      interpretarArgumentos(['--dir', '/x', '--fase', 'cadastro']),
    ).toThrow(/--owner-email/);
  });

  it('recusa fase desconhecida', () => {
    expect(() =>
      interpretarArgumentos([
        ...base.slice(0, 2),
        '--fase',
        'xpto',
        ...base.slice(4),
      ]),
    ).toThrow(/Fase desconhecida/);
  });

  it('lê vários --mapear', () => {
    const o = interpretarArgumentos([
      ...base,
      '--mapear',
      'prof:8=Fulano@Clinica.com',
      '--mapear',
      'func:2=b@c.com',
    ]);
    expect([...o.mapear]).toEqual([
      ['prof:8', 'fulano@clinica.com'],
      ['func:2', 'b@c.com'],
    ]);
  });

  it('recusa --mapear malformado', () => {
    expect(() => interpretarArgumentos([...base, '--mapear', '8=x'])).toThrow(
      /--mapear inválido/,
    );
  });
});

describe('assertBancoPermitido', () => {
  it('recusa NODE_ENV=test', () => {
    expect(() => assertBancoPermitido('inexci', 'test')).toThrow();
  });

  it('recusa o banco dos e2e', () => {
    expect(() => assertBancoPermitido('inexci_test', 'production')).toThrow();
  });

  it('aceita o banco da aplicação', () => {
    expect(() => assertBancoPermitido('inexci', 'production')).not.toThrow();
  });
});
