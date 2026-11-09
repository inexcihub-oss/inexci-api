import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import type { GatewaySubscription } from 'src/shared/payment-gateway/payment-gateway.types';
import { AdminRevenueService } from './admin-revenue.service';

const now = new Date('2026-10-24T15:00:00Z');

const plano = (priceCents: number, billingPeriod: 'MONTHLY' | 'YEARLY') => ({
  id: `plan-${priceCents}-${billingPeriod}`,
  name: `Plano ${priceCents}`,
  priceCents,
  billingPeriod,
});

const assinatura = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  ownerId: `owner-${id}`,
  status: SubscriptionStatus.ACTIVE,
  trialEndsAt: null,
  pastDueSince: null,
  suspendedAt: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date('2026-11-10T12:00:00Z'),
  gatewayProvider: 'stripe',
  gatewayCustomerId: `cus_${id}`,
  gatewaySubscriptionId: `sub_${id}`,
  plan: plano(29900, 'MONTHLY'),
  owner: { id: `owner-${id}`, name: `Clínica ${id}`, email: `${id}@x.com` },
  ...overrides,
});

const gw = (
  id: string,
  overrides: Partial<GatewaySubscription> = {},
): GatewaySubscription => ({
  id: `sub_${id}`,
  customerId: `cus_${id}`,
  status: 'active',
  providerStatus: 'active',
  cycle: 'MONTHLY',
  amountCents: 29900,
  nextDueDate: null,
  priceId: 'price_1',
  currentPeriodStart: new Date('2026-10-10T12:00:00Z'),
  currentPeriodEnd: new Date('2026-11-10T12:00:00Z'),
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  canceledAt: null,
  discount: null,
  ...overrides,
});

describe('AdminRevenueService', () => {
  let repo: Record<string, jest.Mock>;
  let gateway: Record<string, jest.Mock | string>;
  let service: AdminRevenueService;
  let remotas: Record<string, GatewaySubscription | Error>;

  beforeEach(() => {
    remotas = {};
    repo = {
      findRevenueSubscriptions: jest.fn().mockResolvedValue([]),
      findDelinquentSubscriptions: jest.fn().mockResolvedValue([]),
      sumPaidBetween: jest.fn().mockResolvedValue({
        receivedCents: 0,
        discountCents: 0,
        invoices: 0,
      }),
      receivedByMonth: jest.fn().mockResolvedValue([]),
      openTotals: jest.fn().mockResolvedValue({ amountCents: 0, invoices: 0 }),
      outstandingByOwner: jest.fn().mockResolvedValue(new Map()),
      findInvoices: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findPlansWithAccountCounts: jest
        .fn()
        .mockResolvedValue({ plans: [], counts: new Map() }),
    };
    gateway = {
      providerId: 'stripe',
      getSubscriptionWithDiscount: jest.fn((id: string) => {
        const r = remotas[id];
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve(r ?? null);
      }),
      previewNextInvoice: jest.fn().mockResolvedValue(null),
      getCustomerPaymentSummary: jest.fn().mockResolvedValue({
        hasPaymentMethod: false,
        brand: null,
        last4: null,
      }),
      getPrice: jest.fn(),
    };
    service = new AdminRevenueService(repo as never, gateway as never);
  });

  describe('computeMrr', () => {
    beforeEach(() => {
      repo.findRevenueSubscriptions.mockResolvedValue([
        assinatura('a', {
          discountPercentOff: 20,
          discountAmountOffCents: null,
          discountDuration: 'forever',
          discountEndsAt: null,
        }),
        assinatura('b', {
          status: SubscriptionStatus.PAST_DUE,
          plan: plano(299000, 'YEARLY'),
        }),
        assinatura('c', { trialEndsAt: new Date('2026-11-02T12:00:00Z') }),
        assinatura('d', {
          plan: plano(19900, 'MONTHLY'),
          discountPercentOff: 50,
          discountDuration: 'repeating',
          discountEndsAt: new Date('2026-10-01T00:00:00Z'),
        }),
      ]);
    });

    it('mensal com 20%, anual inadimplente, trial e cupom vencido: 23920 + 24916 + 0 + 19900', async () => {
      const result = await service.computeMrr(now);

      expect(result).toEqual({ mrrCents: 68736, payingAccounts: 3 });
      expect(await service.computeMrrCents(now)).toBe(68736);
    });

    it('é 100% local: nenhuma chamada ao gateway', async () => {
      await service.computeMrr(now);
      await service.getSummary('2026-10', now);

      for (const fn of Object.values(gateway)) {
        if (typeof fn === 'function') expect(fn).not.toHaveBeenCalled();
      }
    });
  });

  describe('getSummary', () => {
    it('monta recebido, aberto, inadimplência, MRR, ARR e ticket médio do mês pedido', async () => {
      repo.findRevenueSubscriptions.mockResolvedValue([
        assinatura('a'),
        assinatura('b', { plan: plano(19900, 'MONTHLY') }),
      ]);
      remotas = { sub_a: gw('a'), sub_b: gw('b') };
      repo.sumPaidBetween.mockResolvedValue({
        receivedCents: 53820,
        discountCents: 5980,
        invoices: 2,
      });
      repo.openTotals.mockResolvedValue({ amountCents: 59700, invoices: 3 });
      repo.findDelinquentSubscriptions.mockResolvedValue([
        assinatura('x', {
          status: SubscriptionStatus.PAST_DUE,
          pastDueSince: new Date('2026-10-20T12:00:00Z'),
        }),
        assinatura('y', {
          status: SubscriptionStatus.SUSPENDED,
          pastDueSince: new Date('2026-09-01T12:00:00Z'),
        }),
      ]);
      repo.outstandingByOwner.mockResolvedValue(
        new Map([
          ['owner-x', { amountCents: 29900, invoices: 1 }],
          ['owner-y', { amountCents: 9900, invoices: 1 }],
        ]),
      );
      repo.receivedByMonth.mockResolvedValue([
        { month: '2026-09', receivedCents: 29900 },
        { month: '2026-10', receivedCents: 53820 },
      ]);

      const summary = await service.getSummary('2026-10', now);

      expect(repo.sumPaidBetween).toHaveBeenCalledWith(
        new Date('2026-10-01T03:00:00.000Z'),
        new Date('2026-11-01T03:00:00.000Z'),
      );
      expect(repo.receivedByMonth).toHaveBeenCalledWith(
        new Date('2025-11-01T03:00:00.000Z'),
        new Date('2026-11-01T03:00:00.000Z'),
      );
      expect(repo.outstandingByOwner).toHaveBeenCalledWith([
        'owner-x',
        'owner-y',
      ]);
      expect(summary).toEqual({
        month: '2026-10',
        receivedCents: 53820,
        receivedInvoices: 2,
        discountsCents: 5980,
        openCents: 59700,
        openInvoices: 3,
        delinquentCents: 39800,
        delinquentAccounts: 2,
        mrrCents: 49800,
        arrCents: 597600,
        payingAccounts: 2,
        averageTicketCents: 24900,
        receivedByMonth: [
          { month: '2025-11', receivedCents: 0 },
          { month: '2025-12', receivedCents: 0 },
          { month: '2026-01', receivedCents: 0 },
          { month: '2026-02', receivedCents: 0 },
          { month: '2026-03', receivedCents: 0 },
          { month: '2026-04', receivedCents: 0 },
          { month: '2026-05', receivedCents: 0 },
          { month: '2026-06', receivedCents: 0 },
          { month: '2026-07', receivedCents: 0 },
          { month: '2026-08', receivedCents: 0 },
          { month: '2026-09', receivedCents: 29900 },
          { month: '2026-10', receivedCents: 53820 },
        ],
      });
    });

    it('ticket médio arredonda: 3 contas e MRR 10000 dá 3333', async () => {
      repo.findRevenueSubscriptions.mockResolvedValue([
        assinatura('a', { plan: plano(3333, 'MONTHLY') }),
        assinatura('b', { plan: plano(3333, 'MONTHLY') }),
        assinatura('c', { plan: plano(3334, 'MONTHLY') }),
      ]);

      const summary = await service.getSummary('2026-10', now);

      expect(summary.mrrCents).toBe(10000);
      expect(summary.averageTicketCents).toBe(3333);
    });

    it('sem contas pagantes o ticket médio é zero', async () => {
      const summary = await service.getSummary('2026-10', now);
      expect(summary.mrrCents).toBe(0);
      expect(summary.averageTicketCents).toBe(0);
      expect(summary.delinquentCents).toBe(0);
    });

    it('sem mês usa o mês corrente de SP', async () => {
      const summary = await service.getSummary(
        undefined,
        new Date('2026-11-01T02:00:00Z'),
      );
      expect(summary.month).toBe('2026-10');
    });
  });

  describe('getForecast', () => {
    beforeEach(() => {
      repo.findRevenueSubscriptions.mockResolvedValue([
        assinatura('a'),
        assinatura('b', { cancelAtPeriodEnd: true }),
        assinatura('c', {
          trialEndsAt: new Date('2026-11-02T12:00:00Z'),
          plan: plano(19900, 'MONTHLY'),
        }),
        assinatura('d', {
          trialEndsAt: new Date('2026-11-05T12:00:00Z'),
          plan: plano(19900, 'MONTHLY'),
        }),
        assinatura('e', {
          plan: plano(9900, 'MONTHLY'),
          currentPeriodEnd: new Date('2026-11-15T12:00:00Z'),
        }),
        assinatura('f', { status: SubscriptionStatus.PAST_DUE }),
      ]);
      remotas = {
        sub_a: gw('a'),
        sub_b: gw('b', { cancelAtPeriodEnd: true }),
        sub_c: gw('c', {
          providerStatus: 'trialing',
          amountCents: 19900,
          trialEndsAt: new Date('2026-11-02T12:00:00Z'),
          currentPeriodEnd: new Date('2026-11-02T12:00:00Z'),
        }),
        sub_d: gw('d', {
          providerStatus: 'trialing',
          amountCents: 19900,
          trialEndsAt: new Date('2026-11-05T12:00:00Z'),
        }),
        sub_e: new Error('stripe fora'),
        sub_f: gw('f', { status: 'past_due', providerStatus: 'past_due' }),
      };
      (gateway.previewNextInvoice as jest.Mock).mockImplementation(
        (id: string) => {
          if (id === 'sub_a')
            return Promise.resolve({ amountDueCents: 27000, currency: 'BRL' });
          if (id === 'sub_c') return Promise.reject(new Error('preview fora'));
          return Promise.resolve(null);
        },
      );
      (gateway.getCustomerPaymentSummary as jest.Mock).mockImplementation(
        (customerId: string) =>
          Promise.resolve({
            hasPaymentMethod: customerId === 'cus_c',
            brand: null,
            last4: null,
          }),
      );
    });

    it('soma garantido e trials com cartão por mês, com prévia no próximo e projeção no resto', async () => {
      const forecast = await service.getForecast(6, now);

      expect(
        forecast.months.map((m) => [
          m.month,
          m.guaranteedCents,
          m.trialConversionCents,
        ]),
      ).toEqual([
        ['2026-10', 0, 0],
        ['2026-11', 27000 + 9900, 19900],
        ['2026-12', 29900 + 9900, 19900],
        ['2027-01', 29900 + 9900, 19900],
        ['2027-02', 29900 + 9900, 19900],
        ['2027-03', 29900 + 9900, 19900],
      ]);
      expect(forecast.totalGuaranteedCents).toBe(36900 + 4 * 39800);
      expect(forecast.totalTrialConversionCents).toBe(5 * 19900);
      expect(forecast.partial).toBe(true);
      expect(forecast.months[1].items).toEqual([
        expect.objectContaining({
          ownerId: 'owner-c',
          kind: 'trial_conversion',
          amountCents: 19900,
          source: 'projection',
        }),
        expect.objectContaining({
          ownerId: 'owner-a',
          kind: 'guaranteed',
          amountCents: 27000,
          source: 'preview',
        }),
        expect.objectContaining({
          ownerId: 'owner-e',
          kind: 'guaranteed',
          amountCents: 9900,
          source: 'projection',
        }),
      ]);
    });

    it('cancelamento agendado nem pede prévia; cartão só é consultado para trial', async () => {
      await service.getForecast(6, now);

      expect(gateway.previewNextInvoice).not.toHaveBeenCalledWith('sub_b');
      expect(gateway.getCustomerPaymentSummary).toHaveBeenCalledTimes(2);
      expect(gateway.getCustomerPaymentSummary).toHaveBeenCalledWith('cus_c');
      expect(gateway.getCustomerPaymentSummary).toHaveBeenCalledWith('cus_d');
    });

    it('trial sem cartão e assinatura inadimplente na Stripe ficam fora', async () => {
      const forecast = await service.getForecast(6, now);
      const donos = new Set(
        forecast.months.flatMap((m) => m.items.map((i) => i.ownerId)),
      );
      expect(donos).toEqual(new Set(['owner-a', 'owner-c', 'owner-e']));
    });

    it('sem falhas da Stripe a previsão não é parcial', async () => {
      repo.findRevenueSubscriptions.mockResolvedValue([assinatura('a')]);

      const forecast = await service.getForecast(3, now);

      expect(forecast.partial).toBe(false);
      expect(forecast.months.map((m) => m.guaranteedCents)).toEqual([
        0, 27000, 29900,
      ]);
    });

    it('não pede prévia quando a primeira cobrança cai fora da janela', async () => {
      repo.findRevenueSubscriptions.mockResolvedValue([
        assinatura('a'),
        assinatura('g', { plan: plano(299000, 'YEARLY') }),
      ]);
      remotas = {
        sub_a: gw('a'),
        sub_g: gw('g', {
          cycle: 'YEARLY',
          amountCents: 299000,
          currentPeriodEnd: new Date('2027-06-01T12:00:00Z'),
        }),
      };

      const forecast = await service.getForecast(6, now);

      expect(gateway.previewNextInvoice).toHaveBeenCalledWith('sub_a');
      expect(gateway.previewNextInvoice).not.toHaveBeenCalledWith('sub_g');
      expect(forecast.totalGuaranteedCents).toBe(27000 + 4 * 29900);
    });

    it('reaproveita a leitura da assinatura por 5 minutos', async () => {
      repo.findRevenueSubscriptions.mockResolvedValue([assinatura('a')]);

      await service.getForecast(6, now);
      await service.getForecast(3, now);

      expect(gateway.getSubscriptionWithDiscount).toHaveBeenCalledTimes(1);
    });

    it('pool deslizante: nunca mais de 5 leituras simultâneas e a 6ª não espera o lote', async () => {
      const ids = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
      repo.findRevenueSubscriptions.mockResolvedValue(
        ids.map((id) => assinatura(id)),
      );
      const eventos: string[] = [];
      let emVoo = 0;
      let maximo = 0;
      (gateway.getSubscriptionWithDiscount as jest.Mock).mockImplementation(
        async (subId: string) => {
          emVoo++;
          maximo = Math.max(maximo, emVoo);
          eventos.push(`inicio ${subId}`);
          await new Promise((r) => setTimeout(r, subId === 'sub_p1' ? 40 : 2));
          eventos.push(`fim ${subId}`);
          emVoo--;
          return gw(subId.replace('sub_', ''));
        },
      );

      await service.getForecast(6, now);

      expect(maximo).toBe(5);
      expect(eventos.indexOf('inicio sub_p6')).toBeLessThan(
        eventos.indexOf('fim sub_p1'),
      );
      expect(gateway.getSubscriptionWithDiscount).toHaveBeenCalledTimes(12);
    });

    it('limita a janela entre 1 e 24 meses', async () => {
      expect((await service.getForecast(0, now)).months).toHaveLength(1);
      expect((await service.getForecast(99, now)).months).toHaveLength(24);
    });
  });

  describe('getDelinquency', () => {
    it('lista inadimplentes e suspensas com aberto, dias de atraso e data de suspensão', async () => {
      repo.findDelinquentSubscriptions.mockResolvedValue([
        assinatura('x', {
          status: SubscriptionStatus.PAST_DUE,
          pastDueSince: new Date('2026-10-20T15:00:00Z'),
        }),
        assinatura('y', {
          status: SubscriptionStatus.SUSPENDED,
          pastDueSince: new Date('2026-09-01T15:00:00Z'),
          suspendedAt: new Date('2026-09-08T08:00:00Z'),
        }),
      ]);
      repo.outstandingByOwner.mockResolvedValue(
        new Map([['owner-x', { amountCents: 29900, invoices: 1 }]]),
      );

      const result = await service.getDelinquency(now);

      expect(result.totalOpenCents).toBe(29900);
      expect(result.items).toEqual([
        {
          ownerId: 'owner-x',
          name: 'Clínica x',
          email: 'x@x.com',
          planName: 'Plano 29900',
          status: 'past_due',
          openCents: 29900,
          openInvoices: 1,
          pastDueSince: new Date('2026-10-20T15:00:00Z'),
          daysOverdue: 4,
          suspensionDate: new Date('2026-10-27T15:00:00Z'),
        },
        {
          ownerId: 'owner-y',
          name: 'Clínica y',
          email: 'y@x.com',
          planName: 'Plano 29900',
          status: 'suspended',
          openCents: 0,
          openInvoices: 0,
          pastDueSince: new Date('2026-09-01T15:00:00Z'),
          daysOverdue: 53,
          suspensionDate: new Date('2026-09-08T08:00:00Z'),
        },
      ]);
    });
  });

  describe('listInvoices', () => {
    it('repassa o filtro e devolve o que falta pagar', async () => {
      repo.findInvoices.mockResolvedValue({
        total: 1,
        items: [
          {
            ownerName: 'Clínica A',
            ownerEmail: 'a@x.com',
            invoice: {
              id: 'row-1',
              gatewayInvoiceId: 'in_1',
              ownerId: 'owner-a',
              status: 'open',
              amountDueCents: 29900,
              amountPaidCents: 10000,
              amountDiscountCents: 0,
              currency: 'BRL',
              couponCode: null,
              dueDate: new Date('2026-11-10T00:00:00Z'),
              paidAt: null,
              periodStart: null,
              periodEnd: null,
              invoiceCreatedAt: new Date('2026-11-01T00:00:00Z'),
              hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
            },
          },
        ],
      });

      const result = await service.listInvoices({
        status: 'open',
        ownerId: 'owner-a',
        limit: 10,
        offset: 0,
      });

      expect(repo.findInvoices).toHaveBeenCalledWith({
        status: 'open',
        ownerId: 'owner-a',
        limit: 10,
        offset: 0,
      });
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual({
        id: 'row-1',
        gatewayInvoiceId: 'in_1',
        ownerId: 'owner-a',
        ownerName: 'Clínica A',
        ownerEmail: 'a@x.com',
        status: 'open',
        amountDueCents: 29900,
        amountPaidCents: 10000,
        amountRemainingCents: 19900,
        amountDiscountCents: 0,
        currency: 'BRL',
        couponCode: null,
        dueDate: new Date('2026-11-10T00:00:00Z'),
        paidAt: null,
        periodStart: null,
        periodEnd: null,
        invoiceCreatedAt: new Date('2026-11-01T00:00:00Z'),
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
      });
    });
  });

  describe('listPlans', () => {
    const planoDoBanco = (
      id: string,
      priceCents: number,
      billingPeriod: 'MONTHLY' | 'YEARLY',
      gatewayPriceId: string | null,
    ) => ({
      id,
      slug: id,
      name: id,
      priceCents,
      currency: 'BRL',
      billingPeriod,
      surgeryRequestQuota: 10,
      isActive: true,
      isTrialDefault: id === 'p1',
      gatewayPriceId,
    });

    it('compara valor e período com a Stripe e isola a falha por plano', async () => {
      repo.findPlansWithAccountCounts.mockResolvedValue({
        plans: [
          planoDoBanco('p1', 29900, 'MONTHLY', 'price_ok'),
          planoDoBanco('p2', 299000, 'YEARLY', 'price_valor'),
          planoDoBanco('p3', 299000, 'YEARLY', 'price_periodo'),
          planoDoBanco('p4', 29900, 'MONTHLY', 'price_erro'),
          planoDoBanco('p5', 0, 'MONTHLY', null),
          planoDoBanco('p6', 29900, 'MONTHLY', 'price_sumiu'),
        ],
        counts: new Map([['p1', 4]]),
      });
      (gateway.getPrice as jest.Mock).mockImplementation((id: string) => {
        const precos: Record<string, unknown> = {
          price_ok: {
            id,
            unitAmountCents: 29900,
            cycle: 'MONTHLY',
            currency: 'BRL',
            active: true,
          },
          price_valor: {
            id,
            unitAmountCents: 289000,
            cycle: 'YEARLY',
            currency: 'BRL',
            active: true,
          },
          price_periodo: {
            id,
            unitAmountCents: 299000,
            cycle: 'MONTHLY',
            currency: 'BRL',
            active: true,
          },
        };
        if (id === 'price_erro') return Promise.reject(new Error('fora'));
        return Promise.resolve(precos[id] ?? null);
      });

      const planos = await service.listPlans();

      expect(
        planos.map((p) => [p.id, p.divergent, p.gatewayError, p.accounts]),
      ).toEqual([
        ['p1', false, false, 4],
        ['p2', true, false, 0],
        ['p3', true, false, 0],
        ['p4', null, true, 0],
        ['p5', null, false, 0],
        ['p6', true, false, 0],
      ]);
      expect(planos[1]).toMatchObject({
        gatewayPriceCents: 289000,
        gatewayCycle: 'YEARLY',
      });
      expect(planos[0].isTrialDefault).toBe(true);
    });
  });
});
