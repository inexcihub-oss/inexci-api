import {
  PlanoDoBanco,
  PrecoDoGateway,
  SLUG_PARA_ENV,
  conferirPreco,
  mensagemPrecoInexistente,
  modoDaChave,
  resolverAlvos,
} from './plan-prices';

function plano(over: Partial<PlanoDoBanco> = {}): PlanoDoBanco {
  return {
    slug: 'starter',
    gatewayPriceId: null,
    priceCents: 45800,
    currency: 'BRL',
    billingPeriod: 'MONTHLY',
    ...over,
  };
}

function preco(over: Partial<PrecoDoGateway> = {}): PrecoDoGateway {
  return {
    id: 'price_live_1',
    active: true,
    unitAmount: 45800,
    currency: 'brl',
    interval: 'month',
    ...over,
  };
}

describe('resolverAlvos', () => {
  it('usa o valor do .env quando ele existe', () => {
    const { alvos } = resolverAlvos(
      [plano({ gatewayPriceId: 'price_velho' })],
      {
        STRIPE_PRICE_STARTER_MONTHLY: 'price_novo',
      },
    );

    expect(alvos).toEqual([
      {
        slug: 'starter',
        priceId: 'price_novo',
        origem: 'env',
        jaGravado: false,
      },
    ]);
  });

  /**
   * Sem nada no `.env`, o valor do banco ainda precisa ser conferido — é
   * exatamente esse caminho que pega o price ID podre que entrou por `UPDATE`
   * manual e só apareceu quando um cliente tentou assinar.
   */
  it('valida o que já está no banco quando o .env não traz nada', () => {
    const { alvos } = resolverAlvos(
      [plano({ gatewayPriceId: 'price_banco' })],
      {},
    );

    expect(alvos).toEqual([
      {
        slug: 'starter',
        priceId: 'price_banco',
        origem: 'banco',
        jaGravado: true,
      },
    ]);
  });

  it('marca jaGravado quando o .env repete o que o banco já tem', () => {
    const { alvos } = resolverAlvos(
      [plano({ gatewayPriceId: 'price_igual' })],
      {
        STRIPE_PRICE_STARTER_MONTHLY: 'price_igual',
      },
    );

    expect(alvos[0].jaGravado).toBe(true);
  });

  it('separa os planos sem price ID nenhum em vez de tratá-los como erro', () => {
    const { alvos, semPriceId } = resolverAlvos(
      [plano({ slug: 'enterprise', gatewayPriceId: null })],
      {},
    );

    expect(alvos).toEqual([]);
    expect(semPriceId).toEqual(['enterprise']);
  });

  it('ignora espaços em volta do valor da variável', () => {
    const { alvos } = resolverAlvos([plano()], {
      STRIPE_PRICE_STARTER_MONTHLY: '  price_com_espaco  ',
    });

    expect(alvos[0].priceId).toBe('price_com_espaco');
  });

  it('trata variável vazia como ausente e cai para o banco', () => {
    const { alvos } = resolverAlvos(
      [plano({ gatewayPriceId: 'price_banco' })],
      {
        STRIPE_PRICE_STARTER_MONTHLY: '',
      },
    );

    expect(alvos[0]).toMatchObject({ priceId: 'price_banco', origem: 'banco' });
  });

  it('cobre os 8 slugs assináveis, sem incluir enterprise', () => {
    expect(Object.keys(SLUG_PARA_ENV)).toHaveLength(8);
    expect(SLUG_PARA_ENV['enterprise']).toBeUndefined();
  });
});

describe('conferirPreco', () => {
  it('não acusa nada quando plano e preço batem', () => {
    expect(conferirPreco(plano(), preco())).toEqual([]);
  });

  it('acusa preço arquivado na Stripe', () => {
    expect(conferirPreco(plano(), preco({ active: false }))).toEqual([
      'preço está arquivado (inactive) na Stripe',
    ]);
  });

  it('acusa divergência de valor', () => {
    const avisos = conferirPreco(plano(), preco({ unitAmount: 99900 }));

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('458.00');
    expect(avisos[0]).toContain('999.00');
  });

  it('acusa divergência de moeda', () => {
    const avisos = conferirPreco(plano(), preco({ currency: 'usd' }));

    expect(avisos[0]).toContain('BRL');
    expect(avisos[0]).toContain('USD');
  });

  it('compara moeda sem diferenciar caixa', () => {
    expect(
      conferirPreco(plano({ currency: 'brl' }), preco({ currency: 'BRL' })),
    ).toEqual([]);
  });

  /** Price mensal gravado no slug anual (ou vice-versa) — troca clássica. */
  it('acusa periodicidade trocada entre plano mensal e anual', () => {
    const avisos = conferirPreco(
      plano({ slug: 'starter-anual', billingPeriod: 'YEARLY' }),
      preco({ interval: 'month' }),
    );

    expect(avisos[0]).toContain('YEARLY');
    expect(avisos[0]).toContain('"month"');
  });

  it('aceita o intervalo year para plano anual', () => {
    expect(
      conferirPreco(
        plano({ billingPeriod: 'YEARLY', priceCents: 444000 }),
        preco({ interval: 'year', unitAmount: 444000 }),
      ),
    ).toEqual([]);
  });

  it('acumula múltiplas divergências', () => {
    const avisos = conferirPreco(
      plano(),
      preco({ active: false, unitAmount: 1, currency: 'usd' }),
    );

    expect(avisos).toHaveLength(3);
  });
});

describe('modoDaChave', () => {
  it.each([
    ['sk_live_abc', 'live'],
    ['rk_live_abc', 'live'],
    ['sk_test_abc', 'test'],
    ['rk_test_abc', 'test'],
    ['qualquer_outra_coisa', 'desconhecido'],
  ] as const)('classifica %s como %s', (chave, esperado) => {
    expect(modoDaChave(chave)).toBe(esperado);
  });

  it('trata chave ausente como desconhecido', () => {
    expect(modoDaChave(undefined)).toBe('desconhecido');
  });
});

describe('mensagemPrecoInexistente', () => {
  const alvo = {
    slug: 'starter',
    priceId: 'price_1TlcmS',
    origem: 'banco' as const,
    jaGravado: true,
  };

  it('aponta o modo oposto ao da chave em uso', () => {
    const msg = mensagemPrecoInexistente(alvo, 'live');

    expect(msg).toContain('price_1TlcmS');
    expect(msg).toContain('modo live');
    expect(msg).toContain('preços de test');
  });

  it('cita a variável de ambiente quando o valor veio do .env', () => {
    const msg = mensagemPrecoInexistente({ ...alvo, origem: 'env' }, 'test');

    expect(msg).toContain('STRIPE_PRICE_STARTER_MONTHLY');
  });

  it('não chuta o modo quando o prefixo da chave é desconhecido', () => {
    const msg = mensagemPrecoInexistente(alvo, 'desconhecido');

    expect(msg).toContain('Confira em qual modo');
    expect(msg).not.toContain('modo live');
  });
});
