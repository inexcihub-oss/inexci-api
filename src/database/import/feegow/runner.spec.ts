import {
  assertBancoPermitido,
  FASES,
  hojeEmSaoPaulo,
  interpretarArgumentos,
} from './runner';

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

  it('lembretes: padrão é a INEXCI lembrar; --sem-lembretes desliga', () => {
    expect(interpretarArgumentos(base).semLembretes).toBe(false);
    expect(
      interpretarArgumentos([...base, '--sem-lembretes']).semLembretes,
    ).toBe(true);
  });

  it('--dono-nao-profissional é opt-in', () => {
    expect(interpretarArgumentos(base).donoNaoProfissional).toBe(false);
    expect(
      interpretarArgumentos([...base, '--dono-nao-profissional'])
        .donoNaoProfissional,
    ).toBe(true);
  });

  it('--adotar-ledger é opt-in', () => {
    expect(interpretarArgumentos(base).adotarLedger).toBe(false);
    expect(
      interpretarArgumentos([...base, '--adotar-ledger']).adotarLedger,
    ).toBe(true);
  });

  it('--hoje padrão é a data de São Paulo, não a UTC', () => {
    expect(interpretarArgumentos(base).hoje).toBe(hojeEmSaoPaulo());
    expect(hojeEmSaoPaulo(new Date('2026-10-07T01:00:00Z'))).toBe('2026-10-06');
    expect(hojeEmSaoPaulo(new Date('2026-10-07T03:00:00Z'))).toBe('2026-10-07');
  });

  it('recusa --mapear malformado', () => {
    expect(() => interpretarArgumentos([...base, '--mapear', '8=x'])).toThrow(
      /--mapear inválido/,
    );
  });
});

describe('opções do prontuário (T9)', () => {
  const base = ['--dir', '/x', '--fase', 'prontuario', '--sem-banco'];

  it('padrões: caixa livre na anamnese, sem rascunhos, sem modelos vazios', () => {
    expect(interpretarArgumentos(base)).toMatchObject({
      caixaLivre: 'anamnesis',
      incluirRascunhos: false,
      modelosVazios: false,
    });
  });

  it('lê --caixa-livre, --incluir-rascunhos e --modelos-vazios', () => {
    expect(
      interpretarArgumentos([
        ...base,
        '--caixa-livre',
        'conduct',
        '--incluir-rascunhos',
        '--modelos-vazios',
      ]),
    ).toMatchObject({
      caixaLivre: 'conduct',
      incluirRascunhos: true,
      modelosVazios: true,
    });
  });

  it('--bloqueios-so-futuros (padrão: traz o histórico)', () => {
    expect(interpretarArgumentos(base).bloqueiosSoFuturos).toBe(false);
    expect(
      interpretarArgumentos([...base, '--bloqueios-so-futuros'])
        .bloqueiosSoFuturos,
    ).toBe(true);
  });

  it('--verificar dispensa --fase e recusa --sem-banco', () => {
    const o = interpretarArgumentos([
      '--dir',
      '/x',
      '--owner-email',
      'dono@x.com',
      '--verificar',
    ]);
    expect(o).toMatchObject({ verificar: true, fase: 'tudo', dryRun: false });
    expect(() =>
      interpretarArgumentos(['--dir', '/x', '--verificar', '--sem-banco']),
    ).toThrow('não combina com --sem-banco');
  });

  it('recusa --caixa-livre inválido', () => {
    expect(() =>
      interpretarArgumentos([...base, '--caixa-livre', 'diagnosis']),
    ).toThrow('--caixa-livre inválido');
  });

  it('fases na ordem de dependência; só anexos sai do banco', () => {
    expect(FASES.map((f) => f.nome)).toEqual([
      'cadastro',
      'agenda',
      'historico',
      'prontuario',
      'anexos',
      'modelos',
      'disponibilidade',
    ]);
    expect(FASES.filter((f) => f.enviar).map((f) => f.nome)).toEqual([
      'anexos',
    ]);
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
