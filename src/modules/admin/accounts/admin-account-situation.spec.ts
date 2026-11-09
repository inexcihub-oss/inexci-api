import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import {
  PAST_DUE_GRACE_DAYS,
  ceilDaysUntil,
  suspensionDateFor,
} from 'src/modules/billing/billing-days';
import {
  AdminAccountSituation,
  computeAccountSituation,
  computeMonthlyAmountCents,
  discountCentsAt,
  subscriptionDiscount,
  saoPauloMonthKey,
  saoPauloMonthRange,
  saoPauloMonthRangeOf,
  saoPauloWeekStart,
} from './admin-account-situation';

const base = {
  status: SubscriptionStatus.ACTIVE,
  trialEndsAt: null,
  pastDueSince: null,
  cancelAtPeriodEnd: false,
};

describe('computeAccountSituation', () => {
  const now = new Date('2026-10-23T15:00:00Z');

  it('trial com dias restantes', () => {
    const r = computeAccountSituation(
      {
        ...base,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date('2026-10-30T15:00:00Z'),
      },
      now,
    );
    expect(r).toEqual({
      situation: AdminAccountSituation.TRIAL,
      daysLeft: 7,
      daysOverdue: null,
    });
  });

  it('trial vencido informa há quantos dias', () => {
    const r = computeAccountSituation(
      {
        ...base,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date('2026-10-20T15:00:00Z'),
      },
      now,
    );
    expect(r).toEqual({
      situation: AdminAccountSituation.TRIAL_EXPIRED,
      daysLeft: null,
      daysOverdue: 3,
    });
  });

  it('usa o teto de dias, igual ao SubscriptionService, perto da meia-noite', () => {
    const trialEndsAt = new Date('2026-10-30T02:00:00Z');
    const manha = computeAccountSituation(
      { ...base, status: SubscriptionStatus.TRIALING, trialEndsAt },
      new Date('2026-10-23T12:00:00Z'),
    );
    const noite = computeAccountSituation(
      { ...base, status: SubscriptionStatus.TRIALING, trialEndsAt },
      new Date('2026-10-29T01:00:00Z'),
    );
    expect(manha.daysLeft).toBe(7);
    expect(noite.daysLeft).toBe(2);
  });

  it('trial que termina em poucas horas ainda mostra 1 dia', () => {
    const r = computeAccountSituation(
      {
        ...base,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date('2026-10-30T02:00:00Z'),
      },
      new Date('2026-10-29T20:00:00Z'),
    );
    expect(r.situation).toBe(AdminAccountSituation.TRIAL);
    expect(r.daysLeft).toBe(1);
  });

  it('trial vencido há poucas horas mostra pelo menos 1 dia', () => {
    const r = computeAccountSituation(
      {
        ...base,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date('2026-10-30T01:00:00Z'),
      },
      new Date('2026-10-30T02:30:00Z'),
    );
    expect(r.situation).toBe(AdminAccountSituation.TRIAL_EXPIRED);
    expect(r.daysOverdue).toBe(1);
  });

  it('trial sem data é trial sem contagem', () => {
    const r = computeAccountSituation(
      { ...base, status: SubscriptionStatus.TRIALING },
      now,
    );
    expect(r).toEqual({
      situation: AdminAccountSituation.TRIAL,
      daysLeft: null,
      daysOverdue: null,
    });
  });

  it('ativa e cancelamento agendado', () => {
    expect(computeAccountSituation(base, now).situation).toBe(
      AdminAccountSituation.ACTIVE,
    );
    expect(
      computeAccountSituation({ ...base, cancelAtPeriodEnd: true }, now)
        .situation,
    ).toBe(AdminAccountSituation.CANCEL_SCHEDULED);
  });

  it('ACTIVE ainda em trial (trial com cartão na Stripe) é Trial', () => {
    const r = computeAccountSituation(
      { ...base, trialEndsAt: new Date('2026-10-30T15:00:00Z') },
      now,
    );

    expect(r).toEqual({
      situation: AdminAccountSituation.TRIAL,
      daysLeft: 7,
      daysOverdue: null,
    });
  });

  it('ACTIVE em trial com cancelamento agendado continua Trial', () => {
    expect(
      computeAccountSituation(
        {
          ...base,
          cancelAtPeriodEnd: true,
          trialEndsAt: new Date('2026-10-30T15:00:00Z'),
        },
        now,
      ).situation,
    ).toBe(AdminAccountSituation.TRIAL);
  });

  it('ACTIVE com trial já passado é Ativa, nunca Trial vencido', () => {
    expect(
      computeAccountSituation(
        { ...base, trialEndsAt: new Date('2026-10-01T15:00:00Z') },
        now,
      ).situation,
    ).toBe(AdminAccountSituation.ACTIVE);
    expect(
      computeAccountSituation(
        {
          ...base,
          cancelAtPeriodEnd: true,
          trialEndsAt: new Date('2026-10-01T15:00:00Z'),
        },
        now,
      ).situation,
    ).toBe(AdminAccountSituation.CANCEL_SCHEDULED);
  });

  it('inadimplente usa a mesma carência da suspensão', () => {
    const r = computeAccountSituation(
      {
        ...base,
        status: SubscriptionStatus.PAST_DUE,
        pastDueSince: new Date('2026-10-21T15:00:00Z'),
      },
      now,
    );
    expect(r.situation).toBe(AdminAccountSituation.PAST_DUE);
    expect(r.daysLeft).toBe(PAST_DUE_GRACE_DAYS - 2);
    expect(r.daysOverdue).toBe(2);
  });

  it('inadimplente sem data de início não calcula dias', () => {
    const r = computeAccountSituation(
      { ...base, status: SubscriptionStatus.PAST_DUE },
      now,
    );
    expect(r.daysLeft).toBeNull();
  });

  it.each([
    [SubscriptionStatus.SUSPENDED, AdminAccountSituation.SUSPENDED],
    [SubscriptionStatus.CANCELED, AdminAccountSituation.CANCELED],
    [SubscriptionStatus.INTERNAL, AdminAccountSituation.INTERNAL],
  ])('status %s vira %s', (status, situation) => {
    expect(computeAccountSituation({ ...base, status }, now).situation).toBe(
      situation,
    );
  });
});

describe('consistência com a tela do cliente', () => {
  it('daysLeft e daysUntilSuspension usam as mesmas funções do billing', () => {
    const now = new Date('2026-10-23T15:00:00Z');
    const trialEndsAt = new Date('2026-10-26T02:00:00Z');
    const pastDueSince = new Date('2026-10-20T22:00:00Z');
    expect(
      computeAccountSituation(
        { ...base, status: SubscriptionStatus.TRIALING, trialEndsAt },
        now,
      ).daysLeft,
    ).toBe(ceilDaysUntil(trialEndsAt, now));
    expect(
      computeAccountSituation(
        { ...base, status: SubscriptionStatus.PAST_DUE, pastDueSince },
        now,
      ).daysLeft,
    ).toBe(ceilDaysUntil(suspensionDateFor(pastDueSince), now));
  });
});

describe('computeMonthlyAmountCents', () => {
  const mensal = { priceCents: 29900, billingPeriod: 'MONTHLY' };
  const anual = { priceCents: 100001, billingPeriod: 'YEARLY' };

  it('mensal ativa e inadimplente', () => {
    expect(
      computeMonthlyAmountCents({ status: SubscriptionStatus.ACTIVE }, mensal),
    ).toBe(29900);
    expect(
      computeMonthlyAmountCents(
        { status: SubscriptionStatus.PAST_DUE },
        mensal,
      ),
    ).toBe(29900);
  });

  it('ACTIVE ainda em trial vale zero; com trial passado vale o preço', () => {
    const now = new Date('2026-10-23T15:00:00Z');
    expect(
      computeMonthlyAmountCents(
        {
          status: SubscriptionStatus.ACTIVE,
          trialEndsAt: new Date('2026-10-30T15:00:00Z'),
        },
        mensal,
        now,
      ),
    ).toBe(0);
    expect(
      computeMonthlyAmountCents(
        {
          status: SubscriptionStatus.ACTIVE,
          trialEndsAt: new Date('2026-10-01T15:00:00Z'),
        },
        mensal,
        now,
      ),
    ).toBe(29900);
  });

  it('anual divide por 12 arredondando para baixo', () => {
    expect(
      computeMonthlyAmountCents({ status: SubscriptionStatus.ACTIVE }, anual),
    ).toBe(8333);
  });

  it.each([
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.SUSPENDED,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.INTERNAL,
  ])('status %s não gera mensalidade', (status) => {
    expect(computeMonthlyAmountCents({ status }, mensal)).toBe(0);
  });
});

describe('computeMonthlyAmountCents com desconto recorrente gravado na assinatura', () => {
  const now = new Date('2026-10-23T15:00:00Z');
  const mensal = { priceCents: 29900, billingPeriod: 'MONTHLY' };
  const anual = { priceCents: 299000, billingPeriod: 'YEARLY' };
  const semDesconto = {
    discountPercentOff: null,
    discountAmountOffCents: null,
    discountDuration: null,
    discountEndsAt: null,
  };
  const ativa = (overrides: Record<string, unknown> = {}) => ({
    status: SubscriptionStatus.ACTIVE,
    ...semDesconto,
    ...overrides,
  });

  it('20% para sempre no mensal: 29900 - 5980 = 23920', () => {
    expect(
      computeMonthlyAmountCents(
        ativa({ discountPercentOff: 20, discountDuration: 'forever' }),
        mensal,
        now,
      ),
    ).toBe(23920);
  });

  it('R$ 50 fixos repetindo e ainda vigente: 29900 - 5000 = 24900', () => {
    expect(
      computeMonthlyAmountCents(
        ativa({
          discountAmountOffCents: 5000,
          discountDuration: 'repeating',
          discountEndsAt: new Date('2027-01-01T00:00:00Z'),
        }),
        mensal,
        now,
      ),
    ).toBe(24900);
  });

  it('anual com 10%: (299000 - 29900) / 12 = 22425', () => {
    expect(
      computeMonthlyAmountCents(
        ativa({ discountPercentOff: 10, discountDuration: 'forever' }),
        anual,
        now,
      ),
    ).toBe(22425);
  });

  it('desconto que já terminou, de uso único ou ausente não abate', () => {
    expect(
      computeMonthlyAmountCents(
        ativa({
          discountPercentOff: 50,
          discountDuration: 'repeating',
          discountEndsAt: new Date('2026-10-01T00:00:00Z'),
        }),
        mensal,
        now,
      ),
    ).toBe(29900);
    expect(
      computeMonthlyAmountCents(
        ativa({ discountPercentOff: 50, discountDuration: 'once' }),
        mensal,
        now,
      ),
    ).toBe(29900);
    expect(computeMonthlyAmountCents(ativa(), mensal, now)).toBe(29900);
    expect(
      computeMonthlyAmountCents(
        { status: SubscriptionStatus.ACTIVE },
        mensal,
        now,
      ),
    ).toBe(29900);
  });

  it('desconto maior que o preço zera, nunca fica negativo', () => {
    expect(
      computeMonthlyAmountCents(
        ativa({ discountAmountOffCents: 99999, discountDuration: 'forever' }),
        mensal,
        now,
      ),
    ).toBe(0);
  });

  it('trial e acesso interno continuam zero mesmo com desconto', () => {
    const cupom = { discountPercentOff: 10, discountDuration: 'forever' };
    expect(
      computeMonthlyAmountCents(
        ativa({ ...cupom, trialEndsAt: new Date('2026-10-30T15:00:00Z') }),
        mensal,
        now,
      ),
    ).toBe(0);
    expect(
      computeMonthlyAmountCents(
        ativa({ ...cupom, status: SubscriptionStatus.INTERNAL }),
        mensal,
        now,
      ),
    ).toBe(0);
  });
});

describe('subscriptionDiscount', () => {
  it('monta o desconto a partir das colunas da assinatura', () => {
    expect(
      subscriptionDiscount({
        discountPercentOff: 12.5,
        discountAmountOffCents: null,
        discountDuration: 'repeating',
        discountEndsAt: new Date('2027-01-01T00:00:00Z'),
      }),
    ).toEqual({
      name: null,
      percentOff: 12.5,
      amountOffCents: null,
      duration: 'repeating',
      endsAt: new Date('2027-01-01T00:00:00Z'),
    });
  });

  it('sem duração gravada não há desconto', () => {
    expect(
      subscriptionDiscount({
        discountPercentOff: 10,
        discountAmountOffCents: null,
        discountDuration: null,
        discountEndsAt: null,
      }),
    ).toBeNull();
    expect(subscriptionDiscount({})).toBeNull();
  });
});

describe('discountCentsAt', () => {
  const at = new Date('2026-12-05T12:00:00Z');

  it('percentual arredonda para o centavo mais próximo: 33% de 29900 = 9867', () => {
    expect(
      discountCentsAt(
        29900,
        {
          name: null,
          percentOff: 33,
          amountOffCents: null,
          duration: 'forever',
          endsAt: null,
        },
        at,
      ),
    ).toBe(9867);
  });

  it('repetindo vale só antes do fim', () => {
    const cupom = {
      name: null,
      percentOff: 50,
      amountOffCents: null,
      duration: 'repeating' as const,
      endsAt: new Date('2026-12-05T12:00:00Z'),
    };
    expect(
      discountCentsAt(10000, cupom, new Date('2026-12-05T11:59:59Z')),
    ).toBe(5000);
    expect(discountCentsAt(10000, cupom, at)).toBe(0);
  });

  it('uso único só vale quando pedido explicitamente', () => {
    const cupom = {
      name: null,
      percentOff: 50,
      amountOffCents: null,
      duration: 'once' as const,
      endsAt: null,
    };
    expect(discountCentsAt(10000, cupom, at)).toBe(0);
    expect(discountCentsAt(10000, cupom, at, { includeOnce: true })).toBe(5000);
  });
});

describe('mês por chave YYYY-MM em São Paulo', () => {
  it('2026-02 vai de 01/02 00:00 SP a 01/03 00:00 SP', () => {
    const { from, to } = saoPauloMonthRangeOf('2026-02');
    expect(from.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-01T03:00:00.000Z');
  });

  it('dezembro vira o ano', () => {
    const { from, to } = saoPauloMonthRangeOf('2026-12');
    expect(from.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('a chave do mês usa o fuso de SP', () => {
    expect(saoPauloMonthKey(new Date('2026-11-01T02:59:59Z'))).toBe('2026-10');
    expect(saoPauloMonthKey(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11');
  });
});

describe('janelas em São Paulo', () => {
  it('mês começa às 03:00 UTC', () => {
    const { from, to } = saoPauloMonthRange(new Date('2026-11-01T01:00:00Z'));
    expect(from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('semana começa na segunda-feira de SP', () => {
    expect(
      saoPauloWeekStart(new Date('2026-10-23T15:00:00Z')).toISOString(),
    ).toBe('2026-10-19T03:00:00.000Z');
    expect(
      saoPauloWeekStart(new Date('2026-10-26T02:00:00Z')).toISOString(),
    ).toBe('2026-10-19T03:00:00.000Z');
  });
});
