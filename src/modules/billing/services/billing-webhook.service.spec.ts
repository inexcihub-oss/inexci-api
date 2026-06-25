import { BillingWebhookService } from './billing-webhook.service';
import type {
  NormalizedWebhookEvent,
  GatewaySubscription,
} from 'src/shared/payment-gateway/payment-gateway.types';

describe('BillingWebhookService', () => {
  let service: BillingWebhookService;
  let subscriptionRepo: any;
  let eventRepo: any;
  let subscriptionService: any;
  let gateway: any;

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
    };

    service = new BillingWebhookService(
      subscriptionRepo,
      eventRepo,
      subscriptionService,
      gateway,
    );
  });

  // ─── Idempotência e fluxo base ───

  describe('idempotência e fluxo base', () => {
    it('ignora evento de tipo desconhecido sem chamar dispatch', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'unknown', eventId: 'evt_unknown' }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(subscriptionService.syncFromGatewaySubscription).not.toHaveBeenCalled();
    });

    it('pula evento já processado sem reprocessar', async () => {
      gateway.parseWebhookEvent.mockReturnValue(makeEvent());
      eventRepo.findByProviderEvent.mockResolvedValue({
        id: 'stored-evt',
        processedAt: new Date(),
      });

      await service.handle(verifyInput);

      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(subscriptionService.syncFromGatewaySubscription).not.toHaveBeenCalled();
    });

    it('cria registro de evento e marca como processado após dispatch bem-sucedido', async () => {
      const event = makeEvent();
      gateway.parseWebhookEvent.mockReturnValue(event);
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-1' });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());
      subscriptionService.syncFromGatewaySubscription.mockResolvedValue(undefined);

      await service.handle(verifyInput);

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_test_1', eventType: 'subscription.updated' }),
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

      await expect(service.handle(verifyInput)).rejects.toThrow('Stripe timeout');

      expect(eventRepo.update).toHaveBeenCalledWith(
        'stored-2',
        expect.objectContaining({ error: expect.stringContaining('Stripe timeout') }),
      );
    });

    it('reaproveita registro existente (não processado) em vez de criar outro', async () => {
      const event = makeEvent();
      gateway.parseWebhookEvent.mockReturnValue(event);
      eventRepo.findByProviderEvent.mockResolvedValue({ id: 'existing-1', processedAt: null });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());
      subscriptionService.syncFromGatewaySubscription.mockResolvedValue(undefined);

      await service.handle(verifyInput);

      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(eventRepo.update).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({ processedAt: expect.any(Date) }),
      );
    });
  });

  // ─── checkout.completed ───

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
      expect(subscriptionService.syncFromGatewaySubscription).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'gw-sub-1' }),
      );
    });

    it('não sobrescreve gatewaySubscriptionId já existente', async () => {
      gateway.parseWebhookEvent.mockReturnValue(checkoutEvent());
      subscriptionRepo.findByGatewayCustomerId.mockResolvedValue({
        id: 'sub-local',
        gatewaySubscriptionId: 'gw-sub-existing',
      });
      gateway.getSubscription.mockResolvedValue(makeGatewaySub());

      await service.handle(verifyInput);

      expect(subscriptionRepo.update).not.toHaveBeenCalledWith(
        'sub-local',
        expect.objectContaining({ gatewaySubscriptionId: expect.anything() }),
      );
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

      expect(subscriptionService.syncFromGatewaySubscription).not.toHaveBeenCalled();
    });
  });

  // ─── subscription.created / subscription.updated ───

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
        expect(subscriptionService.syncFromGatewaySubscription).toHaveBeenCalledWith(
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
      gateway.parseWebhookEvent.mockReturnValue(makeEvent({ type: 'subscription.updated' }));
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-x' });
      gateway.getSubscription.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(subscriptionService.syncFromGatewaySubscription).not.toHaveBeenCalled();
    });
  });

  // ─── subscription.canceled ───

  describe('subscription.canceled', () => {
    it('localiza subscription local e chama cancelImmediately', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'subscription.canceled', refs: { subscriptionId: 'gw-sub-1' } }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-c' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({ id: 'sub-local-1' });

      await service.handle(verifyInput);

      expect(subscriptionService.cancelImmediately).toHaveBeenCalledWith('sub-local-1');
    });

    it('não falha quando subscription local não existe', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'subscription.canceled', refs: { subscriptionId: 'gw-sub-orphan' } }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-c2' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(subscriptionService.cancelImmediately).not.toHaveBeenCalled();
    });
  });

  // ─── invoice.paid ───

  describe('invoice.paid', () => {
    it('localiza subscription local e chama markActive', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'invoice.paid', refs: { subscriptionId: 'gw-sub-1' } }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-ip' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({ id: 'sub-local-2' });

      await service.handle(verifyInput);

      expect(subscriptionService.markActive).toHaveBeenCalledWith('sub-local-2');
    });

    it('não falha quando subscription local não existe', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'invoice.paid', refs: { subscriptionId: 'gw-no-sub' } }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-ip2' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(subscriptionService.markActive).not.toHaveBeenCalled();
    });
  });

  // ─── invoice.failed / invoice.overdue ───

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
        subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({ id: 'sub-local-3' });

        await service.handle(verifyInput);

        expect(subscriptionService.markPastDue).toHaveBeenCalledWith(
          'sub-local-3',
          occurredAt,
        );
      },
    );

    it('não falha quando subscription local não existe', async () => {
      gateway.parseWebhookEvent.mockReturnValue(
        makeEvent({ type: 'invoice.failed', refs: { subscriptionId: 'gw-no-sub' } }),
      );
      eventRepo.findByProviderEvent.mockResolvedValue(null);
      eventRepo.create.mockResolvedValue({ id: 'stored-if2' });
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await service.handle(verifyInput);

      expect(subscriptionService.markPastDue).not.toHaveBeenCalled();
    });
  });
});
