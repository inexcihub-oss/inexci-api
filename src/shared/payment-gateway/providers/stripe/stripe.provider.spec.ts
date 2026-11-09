import { ConfigService } from '@nestjs/config';

const customersRetrieve = jest.fn();
const paymentMethodsList = jest.fn();
const subscriptionsRetrieve = jest.fn();
const subscriptionsUpdate = jest.fn();
const invoicesList = jest.fn();
const invoicesRetrieve = jest.fn();
const invoicesCreatePreview = jest.fn();
const pricesRetrieve = jest.fn();
const couponsCreate = jest.fn();
const couponsDel = jest.fn();
const promotionCodesCreate = jest.fn();
const promotionCodesList = jest.fn();
const promotionCodesRetrieve = jest.fn();
const promotionCodesUpdate = jest.fn();
const checkoutSessionsCreate = jest.fn();

jest.mock('stripe', () => {
  class StripeError extends Error {
    statusCode?: number;
    code?: string;
  }
  const Stripe = jest.fn().mockImplementation(() => ({
    customers: { retrieve: customersRetrieve },
    paymentMethods: { list: paymentMethodsList },
    subscriptions: {
      retrieve: subscriptionsRetrieve,
      update: subscriptionsUpdate,
    },
    invoices: {
      list: invoicesList,
      retrieve: invoicesRetrieve,
      createPreview: invoicesCreatePreview,
    },
    prices: { retrieve: pricesRetrieve },
    coupons: { create: couponsCreate, del: couponsDel },
    promotionCodes: {
      create: promotionCodesCreate,
      list: promotionCodesList,
      retrieve: promotionCodesRetrieve,
      update: promotionCodesUpdate,
    },
    checkout: { sessions: { create: checkoutSessionsCreate } },
  }));
  (Stripe as unknown as { errors: unknown }).errors = { StripeError };
  return Stripe;
});

import { StripeProvider } from './stripe.provider';

describe('StripeProvider', () => {
  const config = {
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
  };
  let provider: StripeProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new StripeProvider(config as unknown as ConfigService);
  });

  describe('getCustomerPaymentSummary', () => {
    it('lê o cartão da forma de pagamento padrão', async () => {
      customersRetrieve.mockResolvedValue({
        id: 'cus_1',
        invoice_settings: {
          default_payment_method: { card: { brand: 'visa', last4: '4242' } },
        },
      });

      const result = await provider.getCustomerPaymentSummary('cus_1');

      expect(customersRetrieve).toHaveBeenCalledWith('cus_1', {
        expand: ['invoice_settings.default_payment_method'],
      });
      expect(paymentMethodsList).not.toHaveBeenCalled();
      expect(result).toEqual({
        hasPaymentMethod: true,
        brand: 'visa',
        last4: '4242',
      });
    });

    it('sem padrão, usa o primeiro cartão cadastrado', async () => {
      customersRetrieve.mockResolvedValue({
        id: 'cus_1',
        invoice_settings: { default_payment_method: null },
      });
      paymentMethodsList.mockResolvedValue({
        data: [{ card: { brand: 'mastercard', last4: '4444' } }],
      });

      const result = await provider.getCustomerPaymentSummary('cus_1');

      expect(paymentMethodsList).toHaveBeenCalledWith({
        customer: 'cus_1',
        type: 'card',
        limit: 1,
      });
      expect(result).toEqual({
        hasPaymentMethod: true,
        brand: 'mastercard',
        last4: '4444',
      });
    });

    it('sem nenhum cartão devolve vazio', async () => {
      customersRetrieve.mockResolvedValue({
        id: 'cus_1',
        invoice_settings: { default_payment_method: 'pm_1' },
      });
      paymentMethodsList.mockResolvedValue({ data: [] });

      const result = await provider.getCustomerPaymentSummary('cus_1');

      expect(result).toEqual({
        hasPaymentMethod: false,
        brand: null,
        last4: null,
      });
    });

    it('cliente apagado devolve vazio', async () => {
      customersRetrieve.mockResolvedValue({ id: 'cus_1', deleted: true });

      const result = await provider.getCustomerPaymentSummary('cus_1');

      expect(result.hasPaymentMethod).toBe(false);
      expect(paymentMethodsList).not.toHaveBeenCalled();
    });

    it('erro da Stripe vira PaymentGatewayError', async () => {
      customersRetrieve.mockRejectedValue(new Error('boom'));

      await expect(
        provider.getCustomerPaymentSummary('cus_1'),
      ).rejects.toMatchObject({ name: 'PaymentGatewayError' });
    });
  });

  describe('getSubscriptionWithDiscount', () => {
    it('expande os descontos e normaliza o cupom vigente', async () => {
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        trial_end: null,
        items: { data: [{ price: { id: 'price_1', unit_amount: 100 } }] },
        discounts: [
          {
            source: {
              type: 'coupon',
              coupon: {
                name: 'Parceiro',
                percent_off: 20,
                amount_off: null,
                duration: 'forever',
              },
            },
          },
        ],
      });

      const result = await provider.getSubscriptionWithDiscount('sub_1');

      expect(subscriptionsRetrieve).toHaveBeenCalledWith('sub_1', {
        expand: ['discounts.source.coupon'],
      });
      expect(result?.discount).toEqual({
        name: 'Parceiro',
        percentOff: 20,
        amountOffCents: null,
        duration: 'forever',
        endsAt: null,
      });
    });

    it('cupom repetindo traz a data de fim do desconto', async () => {
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: 1798761600,
        items: { data: [{ price: { id: 'price_1', unit_amount: 100 } }] },
        discounts: [
          {
            end: 1798761600,
            source: {
              coupon: {
                name: 'Três meses',
                percent_off: 50,
                amount_off: null,
                duration: 'repeating',
              },
            },
          },
        ],
      });

      const result = await provider.getSubscriptionWithDiscount('sub_1');

      expect(result?.discount?.endsAt).toEqual(new Date(1798761600 * 1000));
      expect(result?.cancelAt).toEqual(new Date(1798761600 * 1000));
    });

    it('desconto sem expand é desconhecido (undefined), não "sem desconto"', async () => {
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_1', unit_amount: 100 } }] },
        discounts: ['di_1'],
      });

      const result = await provider.getSubscriptionWithDiscount('sub_1');

      expect(result?.discount).toBeUndefined();
    });

    it('lista de descontos vazia é "sem desconto" (null)', async () => {
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_1', unit_amount: 100 } }] },
        discounts: [],
      });

      const result = await provider.getSubscription('sub_1');

      expect(result?.discount).toBeNull();
    });
  });

  describe('getSubscription', () => {
    it('não expande descontos (usado por reconciliação e webhook)', async () => {
      subscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_1', unit_amount: 100 } }] },
        discounts: [],
      });

      await provider.getSubscription('sub_1');

      expect(subscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
    });
  });

  describe('updateTrialEnd', () => {
    it('altera o trial_end sem rateio e com a chave de idempotência', async () => {
      const trialEnd = new Date('2026-12-01T15:30:45.000Z');
      subscriptionsUpdate.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'trialing',
        cancel_at_period_end: false,
        trial_end: Math.floor(trialEnd.getTime() / 1000),
        items: {
          data: [
            {
              price: { id: 'price_1', unit_amount: 100 },
              current_period_start: 1761000000,
              current_period_end: Math.floor(trialEnd.getTime() / 1000),
            },
          ],
        },
      });

      const result = await provider.updateTrialEnd('sub_1', trialEnd, 'log-1');

      expect(subscriptionsUpdate).toHaveBeenCalledWith(
        'sub_1',
        {
          trial_end: Math.floor(trialEnd.getTime() / 1000),
          proration_behavior: 'none',
        },
        { idempotencyKey: 'log-1' },
      );
      expect(result.trialEndsAt).toEqual(trialEnd);
      expect(result.currentPeriodEnd).toEqual(trialEnd);
      expect(result.providerStatus).toBe('trialing');
    });

    it('erro da Stripe vira PaymentGatewayError', async () => {
      subscriptionsUpdate.mockRejectedValue(new Error('boom'));

      await expect(
        provider.updateTrialEnd('sub_1', new Date(), 'log-1'),
      ).rejects.toMatchObject({ name: 'PaymentGatewayError' });
    });
  });

  describe('providerStatus', () => {
    it.each(['trialing', 'unpaid', 'paused', 'incomplete_expired'])(
      'preserva o status original da Stripe (%s)',
      async (status) => {
        subscriptionsRetrieve.mockResolvedValue({
          id: 'sub_1',
          customer: 'cus_1',
          status,
          cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_1', unit_amount: 100 } }] },
        });

        const result = await provider.getSubscription('sub_1');

        expect(result?.providerStatus).toBe(status);
      },
    );
  });
  const faturaStripe = (overrides: Record<string, unknown> = {}) => ({
    id: 'in_1',
    customer: 'cus_1',
    status: 'paid',
    amount_due: 29900,
    amount_paid: 23920,
    currency: 'brl',
    created: 1793534400,
    period_start: 1790856000,
    period_end: 1793534400,
    due_date: null,
    hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
    status_transitions: { paid_at: 1793538000 },
    total_discount_amounts: [
      { amount: 5000, discount: 'di_1' },
      { amount: 980, discount: 'di_2' },
    ],
    discounts: [
      {
        id: 'di_1',
        promotion_code: { id: 'promo_1', code: 'BEMVINDO' },
        source: { coupon: { id: 'co_1', name: 'Boas-vindas' } },
      },
    ],
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: 'sub_1', metadata: null },
    },
    ...overrides,
  });

  describe('faturas', () => {
    it('normaliza a fatura com assinatura vinda de parent.subscription_details', async () => {
      invoicesRetrieve.mockResolvedValue(faturaStripe());

      const invoice = await provider.getInvoice('in_1');

      expect(invoicesRetrieve).toHaveBeenCalledWith('in_1', {
        expand: ['discounts.source.coupon', 'discounts.promotion_code'],
      });
      expect(invoice).toEqual({
        id: 'in_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        status: 'paid',
        amountDueCents: 29900,
        amountPaidCents: 23920,
        amountDiscountCents: 5980,
        currency: 'BRL',
        periodStart: new Date(1790856000 * 1000),
        periodEnd: new Date(1793534400 * 1000),
        dueDate: null,
        paidAt: new Date(1793538000 * 1000),
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
        couponCode: 'BEMVINDO',
        createdAt: new Date(1793534400 * 1000),
      });
    });

    it('sem código promocional usa o nome do cupom; desconto em id cru fica sem código', async () => {
      invoicesRetrieve.mockResolvedValueOnce(
        faturaStripe({
          discounts: [
            {
              id: 'di_1',
              promotion_code: null,
              source: { coupon: { id: 'co_1', name: 'Boas-vindas' } },
            },
          ],
        }),
      );
      expect((await provider.getInvoice('in_1'))?.couponCode).toBe(
        'Boas-vindas',
      );

      invoicesRetrieve.mockResolvedValueOnce(
        faturaStripe({ discounts: ['di_1'], total_discount_amounts: null }),
      );
      const crua = await provider.getInvoice('in_1');
      expect(crua?.couponCode).toBeNull();
      expect(crua?.amountDiscountCents).toBe(0);
    });

    it('fatura inexistente devolve null', async () => {
      const StripeLib = jest.requireMock('stripe');
      const err = new StripeLib.errors.StripeError('nope');
      err.statusCode = 404;
      invoicesRetrieve.mockRejectedValue(err);

      expect(await provider.getInvoice('in_x')).toBeNull();
    });

    it('lista com paginação por starting_after e filtro de criação', async () => {
      invoicesList.mockResolvedValue({
        data: [faturaStripe({ id: 'in_9' }), faturaStripe({ id: 'in_8' })],
        has_more: true,
      });

      const page = await provider.listInvoices({
        createdFrom: new Date('2026-01-01T00:00:00Z'),
        startingAfter: 'in_10',
        limit: 2,
      });

      expect(invoicesList).toHaveBeenCalledWith({
        limit: 2,
        starting_after: 'in_10',
        created: { gte: 1767225600 },
        expand: [
          'data.discounts.source.coupon',
          'data.discounts.promotion_code',
        ],
      });
      expect(page.items.map((i) => i.id)).toEqual(['in_9', 'in_8']);
      expect(page.hasMore).toBe(true);
      expect(page.nextStartingAfter).toBe('in_8');
    });

    it('última página não devolve cursor', async () => {
      invoicesList.mockResolvedValue({
        data: [faturaStripe()],
        has_more: false,
      });

      const page = await provider.listInvoices({ limit: 100 });

      expect(invoicesList).toHaveBeenCalledWith({
        limit: 100,
        expand: [
          'data.discounts.source.coupon',
          'data.discounts.promotion_code',
        ],
      });
      expect(page.nextStartingAfter).toBeNull();
    });

    it('prévia da próxima fatura da assinatura', async () => {
      invoicesCreatePreview.mockResolvedValue(
        faturaStripe({ amount_due: 27000, status: 'draft' }),
      );

      const preview = await provider.previewNextInvoice('sub_1');

      expect(invoicesCreatePreview).toHaveBeenCalledWith({
        subscription: 'sub_1',
      });
      expect(preview).toEqual({ amountDueCents: 27000, currency: 'BRL' });
    });

    it('prévia sem próxima fatura (4xx da Stripe) devolve null', async () => {
      const StripeLib = jest.requireMock('stripe');
      const err = new StripeLib.errors.StripeError('no upcoming');
      err.statusCode = 400;
      invoicesCreatePreview.mockRejectedValue(err);

      expect(await provider.previewNextInvoice('sub_1')).toBeNull();
    });

    it('prévia com 404 também é "sem próxima fatura"', async () => {
      const StripeLib = jest.requireMock('stripe');
      const err = new StripeLib.errors.StripeError('missing');
      err.statusCode = 404;
      invoicesCreatePreview.mockRejectedValue(err);

      expect(await provider.previewNextInvoice('sub_1')).toBeNull();
    });

    it.each([401, 403, 409, 429, 500])(
      'prévia com %i não é engolida: vira PaymentGatewayError',
      async (statusCode) => {
        const StripeLib = jest.requireMock('stripe');
        const err = new StripeLib.errors.StripeError('falha');
        err.statusCode = statusCode;
        invoicesCreatePreview.mockRejectedValue(err);

        await expect(
          provider.previewNextInvoice('sub_1'),
        ).rejects.toMatchObject({
          name: 'PaymentGatewayError',
          httpStatus: statusCode,
        });
      },
    );
  });

  describe('getPrice', () => {
    it('normaliza valor, período e moeda', async () => {
      pricesRetrieve.mockResolvedValue({
        id: 'price_1',
        unit_amount: 29900,
        currency: 'brl',
        active: true,
        recurring: { interval: 'month', interval_count: 1 },
      });

      expect(await provider.getPrice('price_1')).toEqual({
        id: 'price_1',
        unitAmountCents: 29900,
        cycle: 'MONTHLY',
        currency: 'BRL',
        active: true,
        productId: null,
      });
    });

    it('devolve o produto do preço, string ou objeto', async () => {
      pricesRetrieve.mockResolvedValueOnce({
        id: 'price_1',
        unit_amount: 100,
        currency: 'brl',
        active: true,
        product: 'prod_1',
      });
      pricesRetrieve.mockResolvedValueOnce({
        id: 'price_2',
        unit_amount: 100,
        currency: 'brl',
        active: true,
        product: { id: 'prod_2' },
      });

      expect((await provider.getPrice('price_1'))?.productId).toBe('prod_1');
      expect((await provider.getPrice('price_2'))?.productId).toBe('prod_2');
    });

    it('intervalo diferente de 1 mês/1 ano não tem ciclo', async () => {
      pricesRetrieve.mockResolvedValue({
        id: 'price_1',
        unit_amount: 29900,
        currency: 'brl',
        active: true,
        recurring: { interval: 'month', interval_count: 3 },
      });

      expect((await provider.getPrice('price_1'))?.cycle).toBeNull();
    });
  });

  describe('webhook de fatura', () => {
    const evento = (type: string, object: unknown) => ({
      id: 'evt_1',
      type,
      created: 1793534400,
      data: { object },
    });

    it.each([
      ['invoice.payment_succeeded', 'invoice.paid'],
      ['invoice.payment_failed', 'invoice.failed'],
      ['invoice.marked_uncollectible', 'invoice.overdue'],
      ['invoice.finalized', 'invoice.finalized'],
      ['invoice.voided', 'invoice.voided'],
    ])('%s vira %s e carrega a fatura', (stripeType, normalized) => {
      const parsed = provider.parseWebhookEvent(
        evento(stripeType, faturaStripe({ discounts: ['di_1'] })),
      );

      expect(parsed.type).toBe(normalized);
      expect(parsed.invoice).toMatchObject({
        id: 'in_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        amountPaidCents: 23920,
      });
    });

    it('refs leem a assinatura de parent.subscription_details', () => {
      const parsed = provider.parseWebhookEvent(
        evento('invoice.payment_succeeded', faturaStripe()),
      );

      expect(parsed.refs).toEqual({
        invoiceId: 'in_1',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
      });
    });

    it('refs aceitam a assinatura expandida em parent.subscription_details', () => {
      const parsed = provider.parseWebhookEvent(
        evento(
          'invoice.payment_failed',
          faturaStripe({
            parent: {
              type: 'subscription_details',
              subscription_details: {
                subscription: { id: 'sub_exp' },
                metadata: null,
              },
            },
          }),
        ),
      );

      expect(parsed.refs?.subscriptionId).toBe('sub_exp');
    });

    it('refs caem para o campo legado subscription quando não há parent', () => {
      const parsed = provider.parseWebhookEvent(
        evento('invoice.payment_succeeded', {
          ...faturaStripe(),
          parent: null,
          subscription: 'sub_legado',
        }),
      );

      expect(parsed.refs?.subscriptionId).toBe('sub_legado');
    });

    it('payload de fatura malformado não derruba o parse: segue sem a fatura', () => {
      const parsed = provider.parseWebhookEvent(
        evento('invoice.payment_succeeded', {
          id: 'in_bad',
          customer: 'cus_1',
          currency: 42,
          total_discount_amounts: 'quebrado',
        }),
      );

      expect(parsed.type).toBe('invoice.paid');
      expect(parsed.eventId).toBe('evt_1');
      expect(parsed.refs?.invoiceId).toBe('in_bad');
      expect(parsed.invoice).toBeUndefined();
    });

    it('evento que não é de fatura não carrega fatura', () => {
      const parsed = provider.parseWebhookEvent(
        evento('customer.subscription.updated', {
          id: 'sub_1',
          customer: 'cus_1',
        }),
      );

      expect(parsed.invoice).toBeUndefined();
    });
  });
  describe('createCheckoutSession', () => {
    it('liga allow_promotion_codes sem enviar discounts e mantém o restante', async () => {
      checkoutSessionsCreate.mockResolvedValue({
        id: 'cs_1',
        url: 'https://checkout.test/cs_1',
      });

      const result = await provider.createCheckoutSession({
        customerId: 'cus_1',
        priceId: 'price_1',
        successUrl: 'https://app/ok',
        cancelUrl: 'https://app/no',
        subscriptionId: 'sub-local',
        trialEnd: new Date('2026-11-01T00:00:00Z'),
      });

      expect(checkoutSessionsCreate).toHaveBeenCalledWith({
        mode: 'subscription',
        customer: 'cus_1',
        line_items: [{ price: 'price_1', quantity: 1 }],
        success_url: 'https://app/ok',
        cancel_url: 'https://app/no',
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { subscriptionId: 'sub-local' },
          trial_end: Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000),
        },
      });
      expect(checkoutSessionsCreate.mock.calls[0][0]).not.toHaveProperty(
        'discounts',
      );
      expect(result).toMatchObject({
        id: 'cs_1',
        url: 'https://checkout.test/cs_1',
      });
    });
  });

  describe('cupons', () => {
    const cupomStripe = (over: Record<string, unknown> = {}) => ({
      id: 'co_1',
      name: 'MAIO20',
      percent_off: 20,
      amount_off: null,
      currency: null,
      duration: 'repeating',
      duration_in_months: 3,
      valid: true,
      applies_to: { products: ['prod_1'] },
      ...over,
    });
    const promoStripe = (over: Record<string, unknown> = {}) => ({
      id: 'promo_1',
      code: 'MAIO20',
      active: true,
      created: 1793534400,
      expires_at: 1796000000,
      max_redemptions: 10,
      times_redeemed: 2,
      promotion: { type: 'coupon', coupon: cupomStripe() },
      ...over,
    });

    describe('createCoupon', () => {
      it('cria o cupom percentual e o código promocional, ambos com idempotência', async () => {
        promotionCodesList.mockResolvedValue({ data: [] });
        pricesRetrieve.mockResolvedValue({ id: 'price_1', product: 'prod_1' });
        couponsCreate.mockResolvedValue(cupomStripe());
        promotionCodesCreate.mockResolvedValue(
          promoStripe({ promotion: { type: 'coupon', coupon: 'co_1' } }),
        );

        const result = await provider.createCoupon(
          {
            code: 'MAIO20',
            percentOff: 20,
            duration: 'repeating',
            durationInMonths: 3,
            maxRedemptions: 10,
            redeemBy: new Date(1796000000 * 1000),
            appliesToPriceIds: ['price_1', 'price_1'],
          },
          'audit-1',
        );

        expect(promotionCodesList).toHaveBeenCalledWith({
          code: 'MAIO20',
          active: true,
          limit: 1,
        });
        expect(pricesRetrieve).toHaveBeenCalledTimes(2);
        expect(couponsCreate).toHaveBeenCalledWith(
          {
            name: 'MAIO20',
            percent_off: 20,
            duration: 'repeating',
            duration_in_months: 3,
            applies_to: { products: ['prod_1'] },
            expand: ['applies_to'],
          },
          { idempotencyKey: 'audit-1:coupon' },
        );
        expect(promotionCodesCreate).toHaveBeenCalledWith(
          {
            promotion: { type: 'coupon', coupon: 'co_1' },
            code: 'MAIO20',
            max_redemptions: 10,
            expires_at: 1796000000,
          },
          { idempotencyKey: 'audit-1:promo' },
        );
        expect(result).toEqual({
          id: 'promo_1',
          couponId: 'co_1',
          code: 'MAIO20',
          percentOff: 20,
          amountOffCents: null,
          currency: null,
          duration: 'repeating',
          durationInMonths: 3,
          maxRedemptions: 10,
          timesRedeemed: 2,
          expiresAt: new Date(1796000000 * 1000),
          active: true,
          valid: true,
          appliesToProductIds: ['prod_1'],
          createdAt: new Date(1793534400 * 1000),
        });
      });

      it('valor fixo envia amount_off em BRL e não envia restrições vazias', async () => {
        promotionCodesList.mockResolvedValue({ data: [] });
        couponsCreate.mockResolvedValue(
          cupomStripe({
            percent_off: null,
            amount_off: 10000,
            currency: 'brl',
            duration: 'once',
            duration_in_months: null,
            applies_to: undefined,
          }),
        );
        promotionCodesCreate.mockResolvedValue(
          promoStripe({
            expires_at: null,
            max_redemptions: null,
            promotion: { type: 'coupon', coupon: 'co_1' },
          }),
        );

        const result = await provider.createCoupon(
          { code: 'CEM', amountOffCents: 10000, duration: 'once' },
          'audit-2',
        );

        expect(couponsCreate).toHaveBeenCalledWith(
          {
            name: 'CEM',
            amount_off: 10000,
            currency: 'brl',
            duration: 'once',
            expand: ['applies_to'],
          },
          { idempotencyKey: 'audit-2:coupon' },
        );
        expect(promotionCodesCreate).toHaveBeenCalledWith(
          {
            promotion: { type: 'coupon', coupon: 'co_1' },
            code: 'CEM',
          },
          { idempotencyKey: 'audit-2:promo' },
        );
        expect(pricesRetrieve).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          amountOffCents: 10000,
          currency: 'BRL',
          appliesToProductIds: [],
          expiresAt: null,
          maxRedemptions: null,
        });
      });

      it('código já ativo na Stripe vira COUPON_CODE_DUPLICATE (409) sem criar nada', async () => {
        promotionCodesList.mockResolvedValue({ data: [promoStripe()] });

        await expect(
          provider.createCoupon(
            { code: 'MAIO20', percentOff: 20, duration: 'once' },
            'audit-3',
          ),
        ).rejects.toMatchObject({
          code: 'COUPON_CODE_DUPLICATE',
          httpStatus: 409,
        });
        expect(couponsCreate).not.toHaveBeenCalled();
      });

      it('preço sem produto é recusado antes de criar o cupom', async () => {
        promotionCodesList.mockResolvedValue({ data: [] });
        pricesRetrieve.mockResolvedValue({ id: 'price_1', product: null });

        await expect(
          provider.createCoupon(
            {
              code: 'MAIO20',
              percentOff: 20,
              duration: 'once',
              appliesToPriceIds: ['price_1'],
            },
            'audit-4',
          ),
        ).rejects.toMatchObject({ code: 'PRICE_WITHOUT_PRODUCT' });
        expect(couponsCreate).not.toHaveBeenCalled();
      });

      it('falha ao criar o código remove o cupom órfão e propaga o erro', async () => {
        promotionCodesList.mockResolvedValue({ data: [] });
        couponsCreate.mockResolvedValue(cupomStripe());
        promotionCodesCreate.mockRejectedValue(new Error('boom'));
        couponsDel.mockResolvedValue({});

        await expect(
          provider.createCoupon(
            { code: 'MAIO20', percentOff: 20, duration: 'once' },
            'audit-5',
          ),
        ).rejects.toMatchObject({ name: 'PaymentGatewayError' });
        expect(couponsDel).toHaveBeenCalledWith('co_1');
      });
    });

    describe('listCoupons', () => {
      it('pagina com starting_after até esgotar e expande o cupom', async () => {
        promotionCodesList
          .mockResolvedValueOnce({
            data: [promoStripe({ id: 'promo_1' })],
            has_more: true,
          })
          .mockResolvedValueOnce({
            data: [promoStripe({ id: 'promo_2', active: false })],
            has_more: false,
          });

        const result = await provider.listCoupons();

        expect(promotionCodesList).toHaveBeenNthCalledWith(1, {
          limit: 50,
          expand: ['data.promotion.coupon.applies_to'],
        });
        expect(promotionCodesList).toHaveBeenNthCalledWith(2, {
          limit: 50,
          expand: ['data.promotion.coupon.applies_to'],
          starting_after: 'promo_1',
        });
        expect(result.hasMore).toBe(false);
        expect(result.items.map((c) => [c.id, c.active])).toEqual([
          ['promo_1', true],
          ['promo_2', false],
        ]);
      });

      it('respeita o teto de itens', async () => {
        promotionCodesList.mockImplementation(({ limit }: { limit: number }) =>
          Promise.resolve({
            data: Array.from({ length: limit }, (_, i) =>
              promoStripe({ id: 'promo_' + i }),
            ),
            has_more: true,
          }),
        );

        const result = await provider.listCoupons(60);

        expect(result.items).toHaveLength(60);
        expect(result.hasMore).toBe(true);
        expect(promotionCodesList).toHaveBeenCalledTimes(2);
        expect(promotionCodesList).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 10 }),
        );
      });
    });

    describe('listCoupons com o teto exato', () => {
      it('has_more false na última página não marca hasMore', async () => {
        promotionCodesList.mockImplementation(({ limit }: { limit: number }) =>
          Promise.resolve({
            data: Array.from({ length: limit }, (_, i) =>
              promoStripe({ id: 'promo_' + i }),
            ),
            has_more: false,
          }),
        );

        const result = await provider.listCoupons(50);

        expect(result.items).toHaveLength(50);
        expect(result.hasMore).toBe(false);
      });
    });

    describe('getCoupon', () => {
      it('lê o código com o cupom expandido', async () => {
        promotionCodesRetrieve.mockResolvedValue(promoStripe());

        const result = await provider.getCoupon('promo_1');

        expect(promotionCodesRetrieve).toHaveBeenCalledWith('promo_1', {
          expand: ['promotion.coupon.applies_to'],
        });
        expect(result).toMatchObject({ id: 'promo_1', code: 'MAIO20' });
      });

      it('404 vira null', async () => {
        const err = new (jest.requireMock('stripe').errors.StripeError)('nope');
        err.statusCode = 404;
        promotionCodesRetrieve.mockRejectedValue(err);

        expect(await provider.getCoupon('promo_x')).toBeNull();
      });
    });

    describe('deactivateCoupon', () => {
      it('desativa só o código, com idempotência', async () => {
        promotionCodesUpdate.mockResolvedValue(promoStripe({ active: false }));

        await provider.deactivateCoupon('promo_1', 'audit-9');

        expect(promotionCodesUpdate).toHaveBeenCalledWith(
          'promo_1',
          { active: false },
          { idempotencyKey: 'audit-9' },
        );
        expect(couponsDel).not.toHaveBeenCalled();
      });
    });
  });
});
