import type { GatewayInvoice } from 'src/shared/payment-gateway/payment-gateway.types';
import {
  backfillInvoices,
  backfillSubscriptionDiscounts,
  parseBackfillArgs,
} from './backfill-invoices';

describe('backfillInvoices', () => {
  const fatura = (id: string): GatewayInvoice => ({
    id,
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    status: 'paid',
    amountDueCents: 100,
    amountPaidCents: 100,
    amountDiscountCents: 0,
    currency: 'BRL',
    periodStart: null,
    periodEnd: null,
    dueDate: null,
    paidAt: null,
    hostedInvoiceUrl: null,
    couponCode: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  });

  it('pagina pela Stripe com starting_after até acabar e espelha cada fatura', async () => {
    const listInvoices = jest
      .fn()
      .mockResolvedValueOnce({
        items: [fatura('in_3'), fatura('in_2')],
        hasMore: true,
        nextStartingAfter: 'in_2',
      })
      .mockResolvedValueOnce({
        items: [fatura('in_1')],
        hasMore: false,
        nextStartingAfter: null,
      });
    const upsertFromGateway = jest.fn().mockResolvedValue(undefined);
    const createdFrom = new Date('2026-01-01T00:00:00Z');

    const result = await backfillInvoices({
      gateway: { listInvoices },
      mirror: { upsertFromGateway },
      createdFrom,
      pageSize: 2,
      log: jest.fn(),
    });

    expect(listInvoices.mock.calls).toEqual([
      [{ limit: 2, createdFrom, startingAfter: undefined }],
      [{ limit: 2, createdFrom, startingAfter: 'in_2' }],
    ]);
    expect(upsertFromGateway.mock.calls.map((c) => c[0].id)).toEqual([
      'in_3',
      'in_2',
      'in_1',
    ]);
    expect(result).toEqual({ pages: 2, upserted: 3, failed: 0 });
  });

  it('rodar de novo reenvia as mesmas faturas (o upsert é idempotente)', async () => {
    const pagina = {
      items: [fatura('in_1')],
      hasMore: false,
      nextStartingAfter: null,
    };
    const listInvoices = jest.fn().mockResolvedValue(pagina);
    const linhas = new Set<string>();
    const upsertFromGateway = jest.fn((inv: GatewayInvoice) => {
      linhas.add(inv.id);
      return Promise.resolve();
    });
    const deps = {
      gateway: { listInvoices },
      mirror: { upsertFromGateway },
      log: jest.fn(),
    };

    await backfillInvoices(deps);
    await backfillInvoices(deps);

    expect(upsertFromGateway).toHaveBeenCalledTimes(2);
    expect(linhas.size).toBe(1);
  });

  it('falha numa fatura conta e segue para as próximas', async () => {
    const listInvoices = jest.fn().mockResolvedValue({
      items: [fatura('in_2'), fatura('in_1')],
      hasMore: false,
      nextStartingAfter: null,
    });
    const upsertFromGateway = jest
      .fn()
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce(undefined);
    const log = jest.fn();

    const result = await backfillInvoices({
      gateway: { listInvoices },
      mirror: { upsertFromGateway },
      log,
    });

    expect(result).toEqual({ pages: 1, upserted: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('in_2'));
  });

  it('para quando a Stripe diz que há mais mas não manda cursor', async () => {
    const listInvoices = jest.fn().mockResolvedValue({
      items: [],
      hasMore: true,
      nextStartingAfter: null,
    });

    const result = await backfillInvoices({
      gateway: { listInvoices },
      mirror: { upsertFromGateway: jest.fn() },
      log: jest.fn(),
    });

    expect(listInvoices).toHaveBeenCalledTimes(1);
    expect(result.pages).toBe(1);
  });

  describe('parseBackfillArgs', () => {
    it('lê --from=AAAA-MM-DD', () => {
      expect(parseBackfillArgs(['--from=2026-01-01'])).toEqual({
        createdFrom: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    it('sem argumento traz tudo', () => {
      expect(parseBackfillArgs([])).toEqual({ createdFrom: undefined });
    });

    it('data inválida é recusada', () => {
      expect(() => parseBackfillArgs(['--from=ontem'])).toThrow(/--from/);
    });
  });
  describe('backfillSubscriptionDiscounts', () => {
    const montar = () => {
      const subscriptions = {
        findWithGatewaySubscription: jest.fn().mockResolvedValue([
          {
            id: 'l1',
            gatewaySubscriptionId: 'sub_1',
            gatewayProvider: 'stripe',
          },
          {
            id: 'l2',
            gatewaySubscriptionId: 'sub_2',
            gatewayProvider: 'stripe',
          },
          {
            id: 'l3',
            gatewaySubscriptionId: 'sub_3',
            gatewayProvider: 'stripe',
          },
          {
            id: 'l4',
            gatewaySubscriptionId: 'sub_4',
            gatewayProvider: 'stripe',
          },
        ]),
        updateUnlessInternal: jest.fn().mockResolvedValue(true),
      };
      const gateway = {
        getSubscriptionWithDiscount: jest.fn((id: string) => {
          if (id === 'sub_1') {
            return Promise.resolve({
              id,
              discount: {
                name: 'Parceiro',
                percentOff: 20,
                amountOffCents: null,
                duration: 'forever',
                endsAt: null,
              },
            });
          }
          if (id === 'sub_2') return Promise.resolve({ id, discount: null });
          if (id === 'sub_3') return Promise.resolve(null);
          return Promise.reject(new Error('stripe fora'));
        }),
      };
      return { subscriptions, gateway: gateway as never };
    };

    it('lê com o desconto expandido e grava as colunas pela guarda de acesso interno', async () => {
      const { subscriptions, gateway } = montar();

      const result = await backfillSubscriptionDiscounts({
        subscriptions,
        gateway,
        log: jest.fn(),
      });

      expect(subscriptions.updateUnlessInternal.mock.calls).toEqual([
        [
          'l1',
          {
            discountPercentOff: 20,
            discountAmountOffCents: null,
            discountDuration: 'forever',
            discountEndsAt: null,
          },
        ],
        [
          'l2',
          {
            discountPercentOff: null,
            discountAmountOffCents: null,
            discountDuration: null,
            discountEndsAt: null,
          },
        ],
      ]);
      expect(result).toEqual({ updated: 2, skipped: 1, failed: 1 });
    });

    it('é idempotente: rodar de novo regrava os mesmos valores', async () => {
      const { subscriptions, gateway } = montar();
      const deps = { subscriptions, gateway, log: jest.fn() };

      await backfillSubscriptionDiscounts(deps);
      await backfillSubscriptionDiscounts(deps);

      const calls = subscriptions.updateUnlessInternal.mock.calls;
      expect(calls.slice(0, 2)).toEqual(calls.slice(2, 4));
    });
  });
});
