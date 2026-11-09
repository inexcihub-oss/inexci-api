import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  BillingWebhookService,
  EVENTO_EM_PROCESSAMENTO,
  GATEWAY_EVENT_LOCK_TTL_MS,
} from './billing-webhook.service';
import {
  registerPlatformErrorSink,
  type PlatformErrorEvent,
} from 'src/shared/observability/platform-errors/platform-error-sink';
import type {
  NormalizedWebhookEvent,
  GatewayInvoice,
  GatewaySubscription,
} from 'src/shared/payment-gateway/payment-gateway.types';

describe('BillingWebhookService', () => {
  let service: BillingWebhookService;
  let subscriptionRepo: any;
  let eventRepo: any;
  let subscriptionService: any;
  let gateway: any;
  let invoiceMirror: any;
  let lock: any;

  const makeEvent = (
    overrides: Partial<NormalizedWebhookEvent> = {},
  ): NormalizedWebhookEvent => ({
    eventId: 'evt_test_1',
    type: 'subscription.updated',
    resourceId: 'gw-sub-1',
    occurredAt: new Date('2026-03-01T12:00:00Z'),
    raw: {},
    refs: { subscriptionId: 'gw-sub-1' },
    ...overrides,
  });

  const makeGatewaySub = (overrides = {}): GatewaySubscription => ({
    id: 'gw-sub-1',
    customerId: 'cus_abc',
    status: 'active',
    cycle: 'MONTHLY',
    amountCents: 5000,
    nextDueDate: null,
    priceId: 'price_abc',
    currentPeriodStart: new Date('2026-02-01'),
    currentPeriodEnd: new Date('2026-03-01'),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  });

  const verifyInput = {
    payload: Buffer.from('{}'),
    headers: { 'stripe-signature': 'sig_test' },
  };

  beforeEach(() => {
    subscriptionRepo = {
      findByGatewayCustomerId: jest.fn(),
      findByGatewaySubscriptionId: jest.fn(),
      update: jest.fn(),
    };
    eventRepo = {
      findByProviderEvent: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    subscriptionService = {
      syncFromGatewaySubscription: jest.fn(),
      cancelImmediately: jest.fn(),
      markActive: jest.fn(),
      markPastDue: jest.fn(),
    };
    gateway = {
      providerId: 'stripe',
      verifyWebhook: jest.fn(),
      parseWebhookEvent: jest.fn(),
      getSubscription: jest.fn(),
      getInvoice: jest.fn().mockResolvedValue(null),
      getSubscriptionWithDiscount: jest.fn(),
    };
    invoiceMirror = {
      upsertFromGateway: jest.fn().mockResolvedValue(undefined),
    };

    lock = {
      acquire: jest.fn().mockResolvedValue('tok'),
      release: jest.fn().mockResolvedValue(undefined),
    };

    service = new BillingWebhookService(
      subscriptionRepo,
      eventRepo,
      subscriptionService,
      gateway,
      invoiceMirror,
      lock,
    );
  });

  describe('idempotência e fluxo base', () => {
    it('ignora evento de tipo desconhecido sem chamar dispatch', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'unknown', eventId: 'evt_unknown' }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
    });

    it('pula evento já processado sem reprocessar', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      eventRepo.findByProviderEvent.mockResolvedValue({
        id: 'stored-evt',
        processedAt: new Date(),
      });

      await service.handle(verifyInput);

      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
    });

    it('cria registro de evento e marca como processado após dispatch bem-sucedido', async () => {
      const event = makeEvent();
      gateway.parseWebhookEvent.mockReturnValue(event);
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-1' });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());
      subscriptionService.syncFromGatewaySubscription.mockResolvedValue(
        undefined,
      );

      await service.handle(verifyInput);

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt_test_1',
          eventType: 'subscription.updated',
        }),
      );
      expect(eventRepo.update).toHaveBeenCalledWith(
        'stored-1',
        expect.objectContaining({ processedAt: expect.any(Date), error: null }),
      );
    });

    it('grava erro no registro e relança quando dispatch falha', async () => {
      const event = makeEvent();
      gateway.parseWebhookEvent.mockReturnValue(event);
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-2' });
      gateway.getSubscription.mockRejectedValue(new Error('Stripe timeout'));

      await expect(service.handle(verifyInput)).rejects.toThrow(
        'Stripe timeout',
      );

      expect(eventRepo.update).toHaveBeenCalledWith(
        'stored-2',
        expect.objectContaining({
          error: expect.stringContaining('Stripe timeout'),
        }),
      );
    });

    it('reaproveita registro existente (não processado) em vez de criar outro', async () => {
      const event = makeEvent();
      gateway.parseWebhookEvent.mockReturnValue(event);
      eventRepo.findByProviderEvent.mockResolvedValue({
        id: 'existing-1',
        processedAt: null,
      });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());
      subscriptionService.syncFromGatewaySubscription.mockResolvedValue(
        undefined,
      );

      await service.handle(verifyInput);

      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(eventRepo.update).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({ processedAt: expect.any(Date) }),
      );
    });
  });

  describe('checkout.completed', () => {
    const checkoutEvent = () =>
      makeEvent({
        type: 'checkout.completed',
        eventId: 'evt_checkout_1',
        refs: { customerId: 'cus_abc', subscriptionId: 'gw-sub-1' },
      });

    beforeEach(() => {
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-co' });
    });

    it('vincula gatewaySubscriptionId e chama sync', async () => {
      gateway.parseWebhookEvent.mockReturnValue(checkoutEvent());
      subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
        id: 'sub-local',
        gatewaySubscriptionId: null,
      });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());

      await service.handle(verifyInput);

      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-local', {
        gatewaySubscriptionId: 'gw-sub-1',
      });
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).toHaveBeenCalledWith(expect.objectContaining({ id: 'gw-sub-1' }));
    });

    it('sobrescreve gatewaySubscriptionId quando checkout retorna um novo id', async () => {
      gateway.parseWebhookEvent.mockReturnValue(checkoutEvent());
      subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
        id: 'sub-local',
        gatewaySubscriptionId: 'gw-sub-existing',
      });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());

      await service.handle(verifyInput);

      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-local', {
        gatewaySubscriptionId: 'gw-sub-1',
      });
    });

    it('retorna silenciosamente quando customerId ou subscriptionId ausente', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'checkout.completed', refs: {} }),
      );

      await service.handle(verifyInput);

      expect(subscriptionRepo.findByGatewayCustomerId).not.toHaveBeenCalled();
    });

    it('retorna silenciosamente quando customer local não existe', async () => {
      gateway.parseWebhookEvent.mockReturnValue(checkoutEvent());
      subscriptionRepo.findByGatewayCustomerId.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(gateway.getSubscription).not.toHaveBeenCalled();
    });

    it('não chama sync quando getSubscription retorna null', async () => {
      gateway.parseWebhookEvent.mockReturnValue(checkoutEvent());
      subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
        id: 'sub-local',
        gatewaySubscriptionId: null,
      });
      gateway.getSubscription.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
    });
  });

  describe('subscription.created e subscription.updated', () => {
    it.each(['subscription.created', 'subscription.updated'] as const)(
      '%s busca do gateway e chama syncFromGatewaySubscription',
      async (type) => {
        const event = makeEvent({ type, refs: { subscriptionId: 'gw-sub-1' } });
        gateway.parseWebhookEvent.mockReturnValue(event);
        eventRepo.findByProviderEvent.mockResolvedValue(null);
        eventRepo.create.mockResolvedValue({ id: 'stored-s' });
        gateway.getSubscription.mockResolvedValue(makeGatewaySub());

        await service.handle(verifyInput);

        expect(gateway.getSubscription).toHaveBeenCalledWith('gw-sub-1');
        expect(
          subscriptionService.syncFromGatewaySubscription,
        ).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'gw-sub-1', status: 'active' }),
        );
      },
    );

    it('retorna silenciosamente quando subscriptionId ausente', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'subscription.updated', refs: {} }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-x' });

      await service.handle(verifyInput);

      expect(gateway.getSubscription).not.toHaveBeenCalled();
    });

    it('retorna silenciosamente quando gateway não encontra a subscription', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'subscription.updated' }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-x' });
      gateway.getSubscription.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
    });
  });

  describe('subscription.canceled', () => {
    it('localiza subscription local e chama cancelImmediately', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({
          type: 'subscription.canceled',
          refs: { subscriptionId: 'gw-sub-1' },
        }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-c' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-local-1',
      });

      await service.handle(verifyInput);

      expect(subscriptionService.cancelImmediately).toHaveBeenCalledWith(
        'sub-local-1',
      );
    });

    it('não falha quando subscription local não existe', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({
          type: 'subscription.canceled',
          refs: { subscriptionId: 'gw-sub-orphan' },
        }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-c2' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(subscriptionService.cancelImmediately).not.toHaveBeenCalled();
    });
  });

  describe('invoice.paid', () => {
    it('localiza subscription local e chama markActive', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({
          type: 'invoice.paid',
          refs: { subscriptionId: 'gw-sub-1' },
        }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-ip' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-local-2',
      });

      await service.handle(verifyInput);

      expect(subscriptionService.markActive).toHaveBeenCalledWith(
        'sub-local-2',
      );
    });

    it('não falha quando subscription local não existe', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({
          type: 'invoice.paid',
          refs: { subscriptionId: 'gw-no-sub' },
        }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-ip2' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(subscriptionService.markActive).not.toHaveBeenCalled();
    });
  });

  describe('invoice.failed e invoice.overdue', () => {
    it.each(['invoice.failed', 'invoice.overdue'] as const)(
      '%s chama markPastDue com a data do evento',
      async (type) => {
        const occurredAt = new Date('2026-03-15T08:00:00Z');
        gateway.parseWebhookEvent.mockReturnValue(
          makeEvent({ type, occurredAt, refs: { subscriptionId: 'gw-sub-1' } }),
        );
        eventRepo.findByProviderEvent.mockResolvedValue(null);
        eventRepo.create.mockResolvedValue({ id: 'stored-if' });
        subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
          id: 'sub-local-3',
        });

        await service.handle(verifyInput);

        expect(subscriptionService.markPastDue).toHaveBeenCalledWith(
          'sub-local-3',
          occurredAt,
        );
      },
    );

    it('não falha quando subscription local não existe', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({
          type: 'invoice.failed',
          refs: { subscriptionId: 'gw-no-sub' },
        }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-if2' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(subscriptionService.markPastDue).not.toHaveBeenCalled();
    });
  });

  describe('acesso interno', () => {
    it('checkout.completed atrasado não religa a assinatura internal', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({
          type: 'checkout.completed',
          refs: { customerId: 'cus_abc', subscriptionId: 'gw-sub-9' },
        }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-int' });
      subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
        id: 'sub-local',
        status: 'internal',
        gatewaySubscriptionId: null,
      });

      await service.handle(verifyInput);

      expect(subscriptionRepo.update).not.toHaveBeenCalled();
      expect(gateway.getSubscription).not.toHaveBeenCalled();
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
      expect(eventRepo.update).toHaveBeenCalledWith(
        'stored-int',
        expect.objectContaining({ processedAt: expect.any(Date) }),
      );
    });
  });
  describe('espelho de faturas', () => {
    const fatura = (
      overrides: Partial<GatewayInvoice> = {},
    ): GatewayInvoice => ({
      id: 'in_1',
      customerId: 'cus_abc',
      subscriptionId: 'gw-sub-1',
      status: 'paid',
      amountDueCents: 29900,
      amountPaidCents: 29900,
      amountDiscountCents: 0,
      currency: 'BRL',
      periodStart: null,
      periodEnd: null,
      dueDate: null,
      paidAt: new Date('2026-11-01T01:00:00Z'),
      hostedInvoiceUrl: null,
      couponCode: null,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      ...overrides,
    });

    const eventoDeFatura = (
      type: NormalizedWebhookEvent['type'],
      invoice: GatewayInvoice = fatura(),
    ) =>
      makeEvent({
        type,
        resourceId: invoice.id,
        refs: { invoiceId: invoice.id, subscriptionId: 'gw-sub-1' },
        invoice,
      });

    beforeEach(() => {
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-inv' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-local-9',
      });
    });

    it.each([
      'invoice.paid',
      'invoice.failed',
      'invoice.overdue',
      'invoice.finalized',
      'invoice.voided',
    ] as const)('%s espelha a fatura relida da Stripe', async (type) => {
      const relida = fatura({ couponCode: 'BEMVINDO' });
      gateway.parseWebhookEvent.mockReturnValue(eventoDeFatura(type));
      gateway.getInvoice.mockResolvedValue(relida);

      await service.handle(verifyInput);

      expect(gateway.getInvoice).toHaveBeenCalledWith('in_1');
      expect(invoiceMirror.upsertFromGateway).toHaveBeenCalledWith(relida);
      expect(eventRepo.update).toHaveBeenCalledWith(
        'stored-inv',
        expect.objectContaining({ processedAt: expect.any(Date) }),
      );
    });

    it('regressão: status da assinatura segue igual com o espelho ligado', async () => {
      const occurredAt = new Date('2026-03-15T08:00:00Z');
      gateway.parseWebhookEvent.mockReturnValueOnce(
        eventoDeFatura('invoice.paid'),
      );
      await service.handle(verifyInput);
      gateway.parseWebhookEvent.mockReturnValueOnce({
        ...eventoDeFatura('invoice.failed'),
        occurredAt,
      });
      await service.handle(verifyInput);

      expect(subscriptionService.markActive).toHaveBeenCalledTimes(1);
      expect(subscriptionService.markActive).toHaveBeenCalledWith(
        'sub-local-9',
      );
      expect(subscriptionService.markPastDue).toHaveBeenCalledTimes(1);
      expect(subscriptionService.markPastDue).toHaveBeenCalledWith(
        'sub-local-9',
        occurredAt,
      );
    });

    it.each(['invoice.finalized', 'invoice.voided'] as const)(
      '%s não mexe no status da assinatura',
      async (type) => {
        gateway.parseWebhookEvent.mockReturnValue(eventoDeFatura(type));

        await service.handle(verifyInput);

        expect(subscriptionService.markActive).not.toHaveBeenCalled();
        expect(subscriptionService.markPastDue).not.toHaveBeenCalled();
        expect(subscriptionService.cancelImmediately).not.toHaveBeenCalled();
        expect(
          subscriptionService.syncFromGatewaySubscription,
        ).not.toHaveBeenCalled();
      },
    );

    it('falha ao reler a fatura usa o retrato do evento', async () => {
      const doEvento = fatura({ status: 'open', paidAt: null });
      gateway.parseWebhookEvent.mockReturnValue(
        eventoDeFatura('invoice.finalized', doEvento),
      );
      gateway.getInvoice.mockRejectedValue(new Error('stripe fora'));

      await service.handle(verifyInput);

      expect(invoiceMirror.upsertFromGateway).toHaveBeenCalledWith(doEvento);
    });

    it('falha do espelho não derruba o webhook nem desfaz o status', async () => {
      gateway.parseWebhookEvent.mockReturnValue(eventoDeFatura('invoice.paid'));
      invoiceMirror.upsertFromGateway.mockRejectedValue(new Error('db fora'));

      await expect(service.handle(verifyInput)).resolves.toBeUndefined();

      expect(subscriptionService.markActive).toHaveBeenCalledWith(
        'sub-local-9',
      );
      expect(eventRepo.update).toHaveBeenCalledWith('stored-inv', {
        processedAt: expect.any(Date),
        error: null,
      });
    });

    it('evento sem fatura e Stripe sem retorno não espelha nada', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'invoice.voided', refs: { invoiceId: 'in_2' } }),
      );

      await service.handle(verifyInput);

      expect(invoiceMirror.upsertFromGateway).not.toHaveBeenCalled();
    });

    it('eventos de assinatura não tocam no espelho', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());

      await service.handle(verifyInput);

      expect(gateway.getInvoice).not.toHaveBeenCalled();
      expect(invoiceMirror.upsertFromGateway).not.toHaveBeenCalled();
    });
  });
  describe('desconto ao vivo nos eventos de assinatura', () => {
    const cupom = {
      name: 'Parceiro',
      percentOff: 20,
      amountOffCents: null,
      duration: 'forever' as const,
      endsAt: null,
    };

    beforeEach(() => {
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-disc' });
    });

    it('desconto só com ids é relido expandido e vai para o sync', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      gateway.getSubscription.mockResolvedValue(
        makeGatewaySub({ discount: undefined }),
      );
      gateway.getSubscriptionWithDiscount.mockResolvedValue(
        makeGatewaySub({ discount: cupom }),
      );

      await service.handle(verifyInput);

      expect(gateway.getSubscriptionWithDiscount).toHaveBeenCalledWith(
        'gw-sub-1',
      );
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'gw-sub-1', discount: cupom }),
      );
    });

    it('falha ao reler o desconto não derruba o webhook nem limpa o desconto gravado', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      gateway.getSubscription.mockResolvedValue(
        makeGatewaySub({ discount: undefined }),
      );
      gateway.getSubscriptionWithDiscount.mockRejectedValue(
        new Error('stripe fora'),
      );

      await expect(service.handle(verifyInput)).resolves.toBeUndefined();

      const synced =
        subscriptionService.syncFromGatewaySubscription.mock.calls[0][0];
      expect(synced.discount).toBeUndefined();
      expect(eventRepo.update).toHaveBeenCalledWith('stored-disc', {
        processedAt: expect.any(Date),
        error: null,
      });
    });

    it('assinatura sem descontos não faz chamada extra', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      gateway.getSubscription.mockResolvedValue(
        makeGatewaySub({ discount: null }),
      );

      await service.handle(verifyInput);

      expect(gateway.getSubscriptionWithDiscount).not.toHaveBeenCalled();
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).toHaveBeenCalledWith(expect.objectContaining({ discount: null }));
    });

    it('checkout.completed não faz a releitura (só customer.subscription.*)', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({
          type: 'checkout.completed',
          refs: { customerId: 'cus_abc', subscriptionId: 'gw-sub-1' },
        }),
      );
      subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
        id: 'sub-local',
        status: 'active',
        gatewaySubscriptionId: 'gw-sub-1',
      });
      gateway.getSubscription.mockResolvedValue(
        makeGatewaySub({ discount: undefined }),
      );

      await service.handle(verifyInput);

      expect(gateway.getSubscriptionWithDiscount).not.toHaveBeenCalled();
    });
  });

  describe('reprocessStored', () => {
    it('processa o payload gravado, sem verificar assinatura, e marca como processado', async () => {
      const event = makeEvent();
      eventRepo.findOne.mockResolvedValue({
        id: 'stored-9',
        processedAt: null,
        payload: { id: 'evt_test_1', type: 'customer.subscription.updated' },
      });
      gateway.parseWebhookEvent.mockReturnValue(event);
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());

      const result = await service.reprocessStored('stored-9');

      expect(gateway.verifyWebhook).not.toHaveBeenCalled();
      expect(gateway.parseWebhookEvent).toHaveBeenCalledWith({
        id: 'evt_test_1',
        type: 'customer.subscription.updated',
      });
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).toHaveBeenCalled();
      expect(eventRepo.update).toHaveBeenCalledWith(
        'stored-9',
        expect.objectContaining({ processedAt: expect.any(Date), error: null }),
      );
      expect(result).toEqual({
        id: 'stored-9',
        eventId: 'evt_test_1',
        processedAt: expect.any(Date),
      });
    });

    it('evento já processado dá 409 e não reprocessa', async () => {
      eventRepo.findOne.mockResolvedValue({
        id: 'stored-9',
        processedAt: new Date(),
        payload: {},
      });
      await expect(service.reprocessStored('stored-9')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(gateway.parseWebhookEvent).not.toHaveBeenCalled();
    });

    it('evento inexistente dá 404', async () => {
      eventRepo.findOne.mockResolvedValue(null);
      await expect(service.reprocessStored('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('payload não reconhecido dá 409', async () => {
      eventRepo.findOne.mockResolvedValue({
        id: 'stored-9',
        processedAt: null,
        payload: {},
      });
      gateway.parseWebhookEvent.mockReturnValue(makeEvent({ type: 'unknown' }));
      await expect(service.reprocessStored('stored-9')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('concorrência no processamento do evento', () => {
    it('reprocessamento pega a trava do evento e a libera no fim', async () => {
      eventRepo.findOne.mockResolvedValue({
        id: 'stored-9',
        processedAt: null,
        payload: {},
      });
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());

      await service.reprocessStored('stored-9');

      expect(lock.acquire).toHaveBeenCalledWith(
        'gateway-event:stored-9',
        GATEWAY_EVENT_LOCK_TTL_MS,
      );
      expect(lock.acquire.mock.invocationCallOrder[0]).toBeLessThan(
        eventRepo.findOne.mock.invocationCallOrder[0],
      );
      expect(lock.release).toHaveBeenCalledWith(
        'gateway-event:stored-9',
        'tok',
      );
    });

    it('reprocessamento concorrente dá 409 e não despacha o evento', async () => {
      lock.acquire.mockResolvedValue(null);

      await expect(service.reprocessStored('stored-9')).rejects.toThrow(
        EVENTO_EM_PROCESSAMENTO,
      );
      expect(eventRepo.findOne).not.toHaveBeenCalled();
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
      expect(lock.release).not.toHaveBeenCalled();
    });

    it('reprocessamento libera a trava mesmo quando o evento já foi processado', async () => {
      eventRepo.findOne.mockResolvedValue({
        id: 'stored-9',
        processedAt: new Date(),
        payload: {},
      });

      await expect(service.reprocessStored('stored-9')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(lock.release).toHaveBeenCalledWith(
        'gateway-event:stored-9',
        'tok',
      );
    });

    it('webhook com o evento em processamento devolve 409 para a Stripe tentar de novo', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      eventRepo.findByProviderEvent.mockResolvedValue({
        id: 'stored-9',
        processedAt: null,
      });
      lock.acquire.mockResolvedValue(null);

      await expect(service.handle(verifyInput)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
    });

    it('webhook não despacha se o evento foi processado enquanto esperava a trava', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      eventRepo.findByProviderEvent.mockResolvedValue({
        id: 'stored-9',
        processedAt: null,
      });
      eventRepo.findOne.mockResolvedValue({
        id: 'stored-9',
        processedAt: new Date(),
      });

      await service.handle(verifyInput);

      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).not.toHaveBeenCalled();
      expect(eventRepo.update).not.toHaveBeenCalled();
      expect(lock.release).toHaveBeenCalledWith(
        'gateway-event:stored-9',
        'tok',
      );
    });

    it('webhook com o Redis fora processa sem a trava', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      eventRepo.findByProviderEvent.mockResolvedValue({
        id: 'stored-9',
        processedAt: null,
      });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());
      lock.acquire.mockRejectedValue(new Error('redis fora'));

      await service.handle(verifyInput);

      expect(
        subscriptionService.syncFromGatewaySubscription,
      ).toHaveBeenCalled();
      expect(lock.release).not.toHaveBeenCalled();
    });
  });

  describe('registro de erros do webhook', () => {
    let reported: PlatformErrorEvent[];

    beforeEach(() => {
      reported = [];
      registerPlatformErrorSink((event) => reported.push(event));
    });

    afterEach(() => registerPlatformErrorSink(null));

    it('falha no processamento vai para a contagem de erros como stripe_webhook, com a conta', async () => {
      const event = makeEvent();
      gateway.parseWebhookEvent.mockReturnValue(event);
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-1' });
      gateway.getSubscription.mockRejectedValue(new Error('Stripe fora'));
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        ownerId: 'owner-1',
      });

      await expect(service.handle(verifyInput)).rejects.toThrow('Stripe fora');
      await new Promise((resolve) => setImmediate(resolve));

      expect(reported).toEqual([
        expect.objectContaining({
          source: 'stripe_webhook',
          route: 'subscription.updated',
          ownerId: 'owner-1',
        }),
      ]);
    });

    it('sem assinatura local, registra o erro sem conta', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-1' });
      gateway.getSubscription.mockRejectedValue(new Error('Stripe fora'));
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await expect(service.handle(verifyInput)).rejects.toThrow('Stripe fora');
      await new Promise((resolve) => setImmediate(resolve));

      expect(reported[0]).toMatchObject({ ownerId: null });
    });
  });
});
