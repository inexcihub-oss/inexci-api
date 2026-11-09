import {
  ForecastSubscription,
  addMonthsClamped,
  buildForecastMonths,
  localForecastInput,
  nextMonthForecast,
  projectCharges,
} from './revenue-forecast';
import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';

describe('revenue-forecast', () => {
  const now = new Date('2026-10-24T15:00:00Z');
  const janela = {
    from: now,
    to: new Date('2027-04-01T03:00:00Z'),
  };

  const mensal = (
    overrides: Partial<ForecastSubscription> = {},
  ): ForecastSubscription => ({
    ownerId: 'o1',
    name: 'Clínica A',
    email: 'a@x.com',
    kind: 'guaranteed',
    firstChargeAt: new Date('2026-11-10T12:00:00Z'),
    cycle: 'MONTHLY',
    priceCents: 29900,
    discount: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    previewAmountCents: null,
    ...overrides,
  });

  const valores = (sub: ForecastSubscription) =>
    projectCharges(sub, janela).map((c) => [
      c.chargeAt.toISOString().slice(0, 10),
      c.amountCents,
      c.source,
    ]);

  describe('projectCharges', () => {
    it('mensal cobra todo mês a partir do fim do período', () => {
      expect(valores(mensal())).toEqual([
        ['2026-11-10', 29900, 'projection'],
        ['2026-12-10', 29900, 'projection'],
        ['2027-01-10', 29900, 'projection'],
        ['2027-02-10', 29900, 'projection'],
        ['2027-03-10', 29900, 'projection'],
      ]);
    });

    it('a primeira cobrança usa a prévia da Stripe e o resto é projeção', () => {
      expect(
        valores(mensal({ previewAmountCents: 27000 })).slice(0, 2),
      ).toEqual([
        ['2026-11-10', 27000, 'preview'],
        ['2026-12-10', 29900, 'projection'],
      ]);
    });

    it('mensal com cancelamento agendado para no fim do período: nada a cobrar', () => {
      expect(
        valores(mensal({ cancelAtPeriodEnd: true, previewAmountCents: 29900 })),
      ).toEqual([]);
    });

    it('cancelamento em data marcada para de cobrar a partir dela', () => {
      expect(
        valores(mensal({ cancelAt: new Date('2027-01-15T00:00:00Z') })),
      ).toEqual([
        ['2026-11-10', 29900, 'projection'],
        ['2026-12-10', 29900, 'projection'],
        ['2027-01-10', 29900, 'projection'],
      ]);
    });

    it('anual com aniversário dentro da janela cobra uma vez', () => {
      expect(
        valores(
          mensal({
            cycle: 'YEARLY',
            priceCents: 299000,
            firstChargeAt: new Date('2027-02-20T12:00:00Z'),
          }),
        ),
      ).toEqual([['2027-02-20', 299000, 'projection']]);
    });

    it('anual com aniversário fora da janela não cobra nada', () => {
      expect(
        valores(
          mensal({
            cycle: 'YEARLY',
            priceCents: 299000,
            firstChargeAt: new Date('2027-06-01T12:00:00Z'),
          }),
        ),
      ).toEqual([]);
    });

    it('anual que renova este mês não volta a cobrar dentro de 6 meses', () => {
      expect(
        valores(
          mensal({
            cycle: 'YEARLY',
            priceCents: 299000,
            firstChargeAt: new Date('2026-10-30T12:00:00Z'),
          }),
        ),
      ).toEqual([['2026-10-30', 299000, 'projection']]);
    });

    it('cupom de 50% que expira no meio da janela: 10000, 10000 e depois 20000', () => {
      expect(
        valores(
          mensal({
            priceCents: 20000,
            firstChargeAt: new Date('2026-11-05T12:00:00Z'),
            discount: {
              name: 'METADE',
              percentOff: 50,
              amountOffCents: null,
              duration: 'repeating',
              endsAt: new Date('2027-01-01T00:00:00Z'),
            },
          }),
        ),
      ).toEqual([
        ['2026-11-05', 10000, 'projection'],
        ['2026-12-05', 10000, 'projection'],
        ['2027-01-05', 20000, 'projection'],
        ['2027-02-05', 20000, 'projection'],
        ['2027-03-05', 20000, 'projection'],
      ]);
    });

    it('cupom de uso único abate só a primeira cobrança', () => {
      expect(
        valores(
          mensal({
            priceCents: 20000,
            discount: {
              name: null,
              percentOff: null,
              amountOffCents: 5000,
              duration: 'once',
              endsAt: null,
            },
          }),
        ).slice(0, 2),
      ).toEqual([
        ['2026-11-10', 15000, 'projection'],
        ['2026-12-10', 20000, 'projection'],
      ]);
    });

    it('cobrança anterior a agora fica de fora e a prévia vai para a próxima', () => {
      expect(
        valores(
          mensal({
            firstChargeAt: new Date('2026-10-20T12:00:00Z'),
            previewAmountCents: 28000,
          }),
        ).slice(0, 2),
      ).toEqual([
        ['2026-11-20', 28000, 'preview'],
        ['2026-12-20', 29900, 'projection'],
      ]);
    });
  });

  describe('addMonthsClamped', () => {
    it('mantém o dia de âncora e encolhe no fim do mês', () => {
      const base = new Date('2027-01-31T12:00:00Z');
      expect(addMonthsClamped(base, 1).toISOString()).toBe(
        '2027-02-28T12:00:00.000Z',
      );
      expect(addMonthsClamped(base, 2).toISOString()).toBe(
        '2027-03-31T12:00:00.000Z',
      );
      expect(addMonthsClamped(base, 12).toISOString()).toBe(
        '2028-01-31T12:00:00.000Z',
      );
    });
  });

  describe('buildForecastMonths', () => {
    it('agrupa por mês de SP, separando garantido e trials que convertem', () => {
      const meses = buildForecastMonths(
        [
          mensal({ previewAmountCents: 27000 }),
          mensal({
            ownerId: 'o2',
            name: 'Clínica B',
            email: 'b@x.com',
            cycle: 'YEARLY',
            priceCents: 299000,
            firstChargeAt: new Date('2027-02-20T12:00:00Z'),
          }),
          mensal({
            ownerId: 'o3',
            name: 'Clínica C',
            email: 'c@x.com',
            kind: 'trial_conversion',
            priceCents: 19900,
            firstChargeAt: new Date('2026-11-01T02:00:00Z'),
          }),
        ],
        now,
        6,
      );

      expect(meses.map((m) => m.month)).toEqual([
        '2026-10',
        '2026-11',
        '2026-12',
        '2027-01',
        '2027-02',
        '2027-03',
      ]);
      expect(
        meses.map((m) => [m.guaranteedCents, m.trialConversionCents]),
      ).toEqual([
        [0, 19900],
        [27000, 19900],
        [29900, 19900],
        [29900, 19900],
        [29900 + 299000, 19900],
        [29900, 19900],
      ]);
      expect(meses[0].items).toEqual([
        expect.objectContaining({
          ownerId: 'o3',
          kind: 'trial_conversion',
          amountCents: 19900,
        }),
      ]);
      expect(meses[4].items.map((i) => i.ownerId)).toEqual(['o1', 'o2', 'o3']);
    });

    it('sem assinaturas devolve os meses zerados', () => {
      const meses = buildForecastMonths([], now, 3);
      expect(meses).toEqual([
        {
          month: '2026-10',
          guaranteedCents: 0,
          trialConversionCents: 0,
          items: [],
        },
        {
          month: '2026-11',
          guaranteedCents: 0,
          trialConversionCents: 0,
          items: [],
        },
        {
          month: '2026-12',
          guaranteedCents: 0,
          trialConversionCents: 0,
          items: [],
        },
      ]);
    });
  });
  describe('previsão só com dados locais', () => {
    const local = (over: Partial<Subscription>): Subscription =>
      ({
        ownerId: 'o',
        status: SubscriptionStatus.ACTIVE,
        trialEndsAt: null,
        currentPeriodEnd: new Date('2026-11-10T12:00:00Z'),
        cancelAtPeriodEnd: false,
        gatewaySubscriptionId: 'sub_x',
        discountPercentOff: null,
        discountAmountOffCents: null,
        discountDuration: null,
        discountEndsAt: null,
        owner: { name: 'Clínica', email: 'c@x.com' },
        plan: { priceCents: 29900, billingPeriod: 'MONTHLY' },
        ...over,
      }) as Subscription;

    it('sem assinatura na Stripe, inadimplente ou com cancelamento agendado não entra', () => {
      expect(
        localForecastInput(local({ gatewaySubscriptionId: null }), now),
      ).toBeNull();
      expect(
        localForecastInput(local({ status: SubscriptionStatus.PAST_DUE }), now),
      ).toBeNull();
      expect(
        localForecastInput(local({ cancelAtPeriodEnd: true }), now),
      ).toBeNull();
    });

    it('trial com assinatura na Stripe vira conversão na data do fim do trial', () => {
      const input = localForecastInput(
        local({ trialEndsAt: new Date('2026-11-05T12:00:00Z') }),
        now,
      );
      expect(input).toMatchObject({
        kind: 'trial_conversion',
        firstChargeAt: new Date('2026-11-05T12:00:00Z'),
        previewAmountCents: null,
      });
    });

    it('novembro: 299,00 (A) + 299,00 da 2ª cobrança de F = 598,00 garantidos; trial C com 50% once = 99,50; total 697,50', () => {
      const result = nextMonthForecast(
        [
          local({ ownerId: 'A' }),
          local({
            ownerId: 'B',
            currentPeriodEnd: new Date('2027-03-01T12:00:00Z'),
            plan: { priceCents: 299000, billingPeriod: 'YEARLY' } as never,
          }),
          local({
            ownerId: 'C',
            trialEndsAt: new Date('2026-11-05T12:00:00Z'),
            plan: { priceCents: 19900, billingPeriod: 'MONTHLY' } as never,
            discountPercentOff: 50,
            discountDuration: 'once',
          }),
          local({ ownerId: 'D', status: SubscriptionStatus.PAST_DUE }),
          local({ ownerId: 'E', cancelAtPeriodEnd: true }),
          local({
            ownerId: 'F',
            currentPeriodEnd: new Date('2026-10-30T12:00:00Z'),
          }),
        ],
        now,
      );

      expect(result).toEqual({
        month: '2026-11',
        guaranteedCents: 59800,
        trialConversionCents: 9950,
        totalCents: 69750,
      });
    });
  });
});
