import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let subscriptionRepo: any;
  let planRepo: any;
  let quotaPeriodRepo: any;
  let userRepo: any;
  let config: any;
  let gateway: any;

  const buildOwner = () => ({
    id: 'owner-1',
    ownerId: 'owner-1',
    name: 'Owner',
    email: 'owner@inexci.com',
  });

  beforeEach(() => {
    subscriptionRepo = {
      findByOwnerId: jest.fn(),
      findByGatewaySubscriptionId: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    planRepo = {
      findOne: jest.fn(),
      findBySlug: jest.fn(),
      findTrialDefault: jest.fn(),
    };
    quotaPeriodRepo = {
      create: jest.fn(),
      findCurrentForSubscription: jest.fn(),
      update: jest.fn(),
    };
    userRepo = { findOne: jest.fn() };
    config = {
      get: jest.fn((key: string, def: unknown) => {
        if (key === 'BILLING_TRIAL_DAYS') return 30;
        if (key === 'BILLING_GRACE_PERIOD_DAYS') return 7;
        return def;
      }),
    };
    gateway = {
      providerId: 'stripe',
      createCustomer: jest.fn(),
      getCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      createBillingPortalSession: jest.fn(),
      getSubscription: jest.fn(),
      getLatestSubscriptionByCustomer: jest.fn(),
    };

    service = new SubscriptionService(
      subscriptionRepo,
      planRepo,
      quotaPeriodRepo,
      userRepo,
      config,
      gateway,
    );
  });

  describe('createTrialSubscription', () => {
    it('cria subscription TRIALING + período de cota com plano default', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(null);
      planRepo.findTrialDefault.mockResolvedValue({
        id: 'plan-trial',
        slug: 'starter',
        surgeryRequestQuota: 30,
        billingPeriod: 'MONTHLY',
        isActive: true,
      });
      subscriptionRepo.create.mockResolvedValue({ id: 'sub-1' });

      const result = await service.createTrialSubscription('owner-1');

      expect(subscriptionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          planId: 'plan-trial',
          status: SubscriptionStatus.TRIALING,
          gatewayProvider: 'stripe',
        }),
      );
      expect(quotaPeriodRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          surgeryRequestsLimit: 30,
          surgeryRequestsUsed: 0,
        }),
      );
      expect(result.id).toBe('sub-1');
    });

    it('é idempotente — devolve a subscription existente sem recriar', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue({ id: 'sub-x' });

      const result = await service.createTrialSubscription('owner-1');

      expect(result.id).toBe('sub-x');
      expect(subscriptionRepo.create).not.toHaveBeenCalled();
    });

    it('lança quando plano de trial default não está cadastrado', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(null);
      planRepo.findTrialDefault.mockResolvedValue(null);

      await expect(service.createTrialSubscription('owner-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('usa planSlug quando fornecido e o plano está ativo', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(null);
      planRepo.findBySlug.mockResolvedValue({
        id: 'plan-essencial',
        slug: 'essencial',
        surgeryRequestQuota: 20,
        billingPeriod: 'MONTHLY',
        isActive: true,
      });
      subscriptionRepo.create.mockResolvedValue({ id: 'sub-2' });

      const result = await service.createTrialSubscription(
        'owner-1',
        'essencial',
      );

      expect(subscriptionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'plan-essencial' }),
      );
      expect(result.id).toBe('sub-2');
    });
  });

  describe('createInitialSubscription', () => {
    it('delega para createTrialSubscription independente do planSlug', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(null);
      planRepo.findTrialDefault.mockResolvedValue({
        id: 'plan-trial',
        slug: 'starter',
        surgeryRequestQuota: 10,
        billingPeriod: 'MONTHLY',
        isActive: true,
      });
      subscriptionRepo.create.mockResolvedValue({ id: 'sub-3' });

      const result = await service.createInitialSubscription('owner-1');

      expect(subscriptionRepo.create).toHaveBeenCalled();
      expect(result.id).toBe('sub-3');
    });
  });

  describe('cancelImmediately', () => {
    it('marca CANCELED localmente sem chamar o gateway', async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });

      await service.cancelImmediately('sub-1');

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
      );
    });

    it('não falha se subscription não existe', async () => {
      subscriptionRepo.findOne.mockResolvedValue(null);
      await expect(service.cancelImmediately('sub-x')).resolves.toBeUndefined();
    });
  });

  describe('advanceBillingPeriod', () => {
    it('cria novo período de cota e ativa status', async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-1',
        currentPeriodEnd: new Date('2026-02-01'),
      });
      planRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        billingPeriod: 'MONTHLY',
        surgeryRequestQuota: 100,
      });

      await service.advanceBillingPeriod('sub-1');

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({
          status: SubscriptionStatus.ACTIVE,
          pastDueSince: null,
        }),
      );
      expect(quotaPeriodRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          surgeryRequestsLimit: 100,
          surgeryRequestsUsed: 0,
        }),
      );
    });
  });

  describe('markPastDue / markActive', () => {
    it('markPastDue atualiza status e pastDueSince', async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
      });
      const at = new Date();

      await service.markPastDue('sub-1', at);

      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        status: SubscriptionStatus.PAST_DUE,
        pastDueSince: at,
      });
    });

    it('markActive limpa pastDueSince e suspendedAt', async () => {
      subscriptionRepo.findOne.mockResolvedValue({ id: 'sub-1' });

      await service.markActive('sub-1');

      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        status: SubscriptionStatus.ACTIVE,
        pastDueSince: null,
        suspendedAt: null,
      });
    });
  });

  describe('getMySubscription', () => {
    it('proíbe colaborador (não-owner) de acessar a assinatura', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' });

      await expect(service.getMySubscription('user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lança NotFoundException quando não há assinatura', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId.mockResolvedValue(null);

      await expect(service.getMySubscription('owner-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calcula daysLeftInTrial corretamente em TRIALING', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      const trialEnd = new Date();
      trialEnd.setUTCDate(trialEnd.getUTCDate() + 10);
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: trialEnd,
      });

      const result = await service.getMySubscription('owner-1');

      expect(result.daysLeftInTrial).toBeGreaterThanOrEqual(9);
      expect(result.daysLeftInTrial).toBeLessThanOrEqual(10);
    });

    it('reconcilia com gateway quando existe gatewaySubscriptionId', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewaySubscriptionId: 'gw-sub-1',
          planId: 'plan-1',
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          trialEndsAt: null,
          pastDueSince: null,
        })
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewaySubscriptionId: 'gw-sub-1',
          planId: 'plan-1',
          status: SubscriptionStatus.CANCELED,
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          trialEndsAt: null,
          pastDueSince: null,
        });

      // Chamado dentro de syncFromGatewaySubscription
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        ownerId: 'owner-1',
        planId: 'plan-1',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
      });
      gateway.getSubscription.mockResolvedValue({
        id: 'gw-sub-1',
        customerId: 'cus-1',
        status: 'canceled',
        cycle: 'MONTHLY',
        amountCents: 1000,
        nextDueDate: null,
        priceId: 'price_1',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        canceledAt: new Date('2026-01-15'),
      });
      // findOne({ gatewayPriceId }) durante sync
      planRepo.findOne.mockResolvedValue(null);

      const result = await service.getMySubscription('owner-1');

      expect(gateway.getSubscription).toHaveBeenCalledWith('gw-sub-1');
      expect(result.subscription.status).toBe(SubscriptionStatus.CANCELED);
    });

    it('marca como cancelada localmente quando assinatura não existe no gateway', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewaySubscriptionId: 'gw-sub-1',
          status: SubscriptionStatus.ACTIVE,
          planId: 'plan-1',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          trialEndsAt: null,
          pastDueSince: null,
        })
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewaySubscriptionId: 'gw-sub-1',
          status: SubscriptionStatus.CANCELED,
          planId: 'plan-1',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          trialEndsAt: null,
          pastDueSince: null,
        });
      gateway.getSubscription.mockResolvedValue(null);

      const result = await service.getMySubscription('owner-1');

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({
          status: SubscriptionStatus.CANCELED,
          cancelAtPeriodEnd: false,
        }),
      );
      expect(result.subscription.status).toBe(SubscriptionStatus.CANCELED);
    });

    it('reconcilia por customer quando gatewaySubscriptionId está ausente', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: null,
          status: SubscriptionStatus.CANCELED,
          planId: 'plan-1',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          trialEndsAt: null,
          pastDueSince: null,
        })
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-2',
          status: SubscriptionStatus.ACTIVE,
          planId: 'plan-1',
          currentPeriodStart: new Date('2026-02-01'),
          currentPeriodEnd: new Date('2026-03-01'),
          trialEndsAt: null,
          pastDueSince: null,
        });

      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        ownerId: 'owner-1',
        planId: 'plan-1',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
      });

      gateway.getLatestSubscriptionByCustomer.mockResolvedValue({
        id: 'gw-sub-2',
        customerId: 'cus-1',
        status: 'active',
        cycle: 'MONTHLY',
        amountCents: 1000,
        nextDueDate: null,
        priceId: 'price_1',
        currentPeriodStart: new Date('2026-02-01'),
        currentPeriodEnd: new Date('2026-03-01'),
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      });
      planRepo.findOne.mockResolvedValue(null);

      const result = await service.getMySubscription('owner-1');

      expect(gateway.getLatestSubscriptionByCustomer).toHaveBeenCalledWith(
        'cus-1',
      );
      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        gatewaySubscriptionId: 'gw-sub-2',
      });
      expect(result.subscription.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('troca para subscription ativa mais recente do customer quando id atual está cancelado', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-old',
          status: SubscriptionStatus.CANCELED,
          planId: 'plan-1',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          trialEndsAt: null,
          pastDueSince: null,
        })
        .mockResolvedValueOnce({
          id: 'sub-1',
          ownerId: 'owner-1',
          gatewayProvider: 'stripe',
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-new',
          status: SubscriptionStatus.ACTIVE,
          planId: 'plan-1',
          currentPeriodStart: new Date('2026-06-01'),
          currentPeriodEnd: new Date('2026-07-01'),
          trialEndsAt: null,
          pastDueSince: null,
        });

      gateway.getSubscription.mockResolvedValue({
        id: 'gw-sub-old',
        customerId: 'cus-1',
        status: 'canceled',
        cycle: 'MONTHLY',
        amountCents: 1000,
        nextDueDate: null,
        priceId: 'price_1',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        canceledAt: new Date('2026-02-01'),
      });
      gateway.getLatestSubscriptionByCustomer.mockResolvedValue({
        id: 'gw-sub-new',
        customerId: 'cus-1',
        status: 'active',
        cycle: 'MONTHLY',
        amountCents: 5000,
        nextDueDate: null,
        priceId: 'price_1',
        currentPeriodStart: new Date('2026-06-01'),
        currentPeriodEnd: new Date('2026-07-01'),
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      });

      subscriptionRepo.findByGatewaySubscriptionId.mockImplementation(
        async (gatewaySubscriptionId: string) => {
          if (gatewaySubscriptionId === 'gw-sub-new') {
            return {
              id: 'sub-1',
              ownerId: 'owner-1',
              planId: 'plan-1',
              currentPeriodStart: new Date('2026-01-01'),
              currentPeriodEnd: new Date('2026-02-01'),
            };
          }
          return null;
        },
      );
      planRepo.findOne.mockResolvedValue(null);

      const result = await service.getMySubscription('owner-1');

      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        gatewaySubscriptionId: 'gw-sub-new',
      });
      expect(result.subscription.status).toBe(SubscriptionStatus.ACTIVE);
    });
  });

  describe('startCheckout', () => {
    const plan = {
      id: 'plan-1',
      slug: 'starter',
      isActive: true,
      gatewayPriceId: 'price_abc123',
    };

    it('retorna URL do Stripe Checkout para plano válido', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      planRepo.findOne.mockResolvedValue(plan);
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        gatewayCustomerId: 'cus_existing',
        trialEndsAt: null,
      });
      gateway.getCustomer.mockResolvedValue({ id: 'cus_existing' });
      gateway.createCheckoutSession.mockResolvedValue({
        id: 'cs_xxx',
        url: 'https://checkout.stripe.com/xxx',
      });

      const result = await service.startCheckout('owner-1', 'plan-1');

      expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: 'price_abc123',
          customerId: 'cus_existing',
        }),
      );
      expect(result.url).toBe('https://checkout.stripe.com/xxx');
    });

    it('cria customer no gateway se não existir ainda', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      planRepo.findOne.mockResolvedValue(plan);
      subscriptionRepo.findByOwnerId
        .mockResolvedValueOnce({
          id: 'sub-1',
          gatewayCustomerId: null,
          trialEndsAt: null,
        })
        .mockResolvedValueOnce({
          id: 'sub-1',
          gatewayCustomerId: null,
          trialEndsAt: null,
        });
      gateway.createCustomer.mockResolvedValue({ id: 'cus_new' });
      subscriptionRepo.update.mockResolvedValue(undefined);
      gateway.createCheckoutSession.mockResolvedValue({
        id: 'cs_yyy',
        url: 'https://checkout.stripe.com/yyy',
      });

      const result = await service.startCheckout('owner-1', 'plan-1');

      expect(gateway.createCustomer).toHaveBeenCalled();
      expect(result.url).toBe('https://checkout.stripe.com/yyy');
    });

    it('recria customer quando gatewayCustomerId salvo não existe mais no gateway', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      planRepo.findOne.mockResolvedValue(plan);
      subscriptionRepo.findByOwnerId
        .mockResolvedValueOnce({
          id: 'sub-1',
          gatewayCustomerId: 'cus_old_missing',
          trialEndsAt: null,
        })
        .mockResolvedValueOnce({
          id: 'sub-1',
          gatewayCustomerId: 'cus_old_missing',
          trialEndsAt: null,
        });
      gateway.getCustomer.mockResolvedValue(null);
      gateway.createCustomer.mockResolvedValue({ id: 'cus_new' });
      subscriptionRepo.update.mockResolvedValue(undefined);
      gateway.createCheckoutSession.mockResolvedValue({
        id: 'cs_new',
        url: 'https://checkout.stripe.com/new',
      });

      const result = await service.startCheckout('owner-1', 'plan-1');

      expect(gateway.getCustomer).toHaveBeenCalledWith('cus_old_missing');
      expect(gateway.createCustomer).toHaveBeenCalled();
      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        gatewayCustomerId: 'cus_new',
      });
      expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_new' }),
      );
      expect(result.url).toBe('https://checkout.stripe.com/new');
    });

    it('lança BadRequest quando plano não tem gatewayPriceId', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      planRepo.findOne.mockResolvedValue({ ...plan, gatewayPriceId: null });

      await expect(service.startCheckout('owner-1', 'plan-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lança ForbiddenException para colaborador', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-1', ownerId: 'owner-1' });

      await expect(service.startCheckout('user-1', 'plan-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('openBillingPortal', () => {
    it('retorna URL do Customer Portal quando há gatewayCustomerId', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        gatewayCustomerId: 'cus_abc',
      });
      gateway.getCustomer.mockResolvedValue({ id: 'cus_abc' });
      gateway.createBillingPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/portal',
      });

      const result = await service.openBillingPortal('owner-1');

      expect(gateway.createBillingPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_abc' }),
      );
      expect(result.url).toBe('https://billing.stripe.com/portal');
    });

    it('recria customer e abre portal quando gatewayCustomerId local está inválido', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        gatewayCustomerId: 'cus_old_missing',
      });
      gateway.getCustomer.mockResolvedValue(null);
      gateway.createCustomer.mockResolvedValue({ id: 'cus_new' });
      gateway.createBillingPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/portal/new',
      });

      const result = await service.openBillingPortal('owner-1');

      expect(gateway.getCustomer).toHaveBeenCalledWith('cus_old_missing');
      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        gatewayCustomerId: 'cus_new',
      });
      expect(gateway.createBillingPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_new' }),
      );
      expect(result.url).toBe('https://billing.stripe.com/portal/new');
    });

    it('cria customer na Stripe e abre portal quando não há gatewayCustomerId', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        gatewayCustomerId: null,
      });
      gateway.createCustomer.mockResolvedValue({ id: 'cus_new' });
      gateway.createBillingPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/portal',
      });

      const result = await service.openBillingPortal('owner-1');

      expect(gateway.createCustomer).toHaveBeenCalled();
      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        gatewayCustomerId: 'cus_new',
      });
      expect(gateway.createBillingPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_new' }),
      );
      expect(result.url).toBe('https://billing.stripe.com/portal');
    });
  });

  describe('syncFromGatewaySubscription', () => {
    const buildGatewaySub = (overrides = {}) => ({
      id: 'gw-sub-1',
      customerId: 'cus_abc',
      status: 'active' as const,
      cycle: 'MONTHLY' as const,
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

    it('atualiza status e período da subscription local', async () => {
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-1',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
      });
      planRepo.findOne.mockResolvedValue(null);

      await service.syncFromGatewaySubscription(buildGatewaySub());

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
      );
    });

    it('atualiza o planId quando priceId resolve um plano local', async () => {
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-old',
        currentPeriodStart: new Date('2026-01-01'),
      });
      planRepo.findOne
        .mockResolvedValueOnce({ id: 'plan-new', surgeryRequestQuota: 50 }) // findOne({ gatewayPriceId })
        .mockResolvedValue(null);

      await service.syncFromGatewaySubscription(buildGatewaySub());

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ planId: 'plan-new' }),
      );
    });

    it('renova cota quando o período avança', async () => {
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-1',
        currentPeriodStart: new Date('2026-01-01'),
      });
      planRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        surgeryRequestQuota: 30,
      });

      await service.syncFromGatewaySubscription(
        buildGatewaySub({ currentPeriodStart: new Date('2026-02-01') }),
      );

      expect(quotaPeriodRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          surgeryRequestsLimit: 30,
          surgeryRequestsUsed: 0,
        }),
      );
    });

    it('não renova cota quando o período não avança', async () => {
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-1',
        currentPeriodStart: new Date('2026-02-01'),
      });
      planRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        surgeryRequestQuota: 30,
      });

      await service.syncFromGatewaySubscription(
        buildGatewaySub({ currentPeriodStart: new Date('2026-02-01') }),
      );

      expect(quotaPeriodRepo.create).not.toHaveBeenCalled();
    });

    it('ajusta cota do período atual quando há downgrade sem virar ciclo', async () => {
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-old',
        currentPeriodStart: new Date('2026-02-01'),
      });
      planRepo.findOne
        .mockResolvedValueOnce({ id: 'plan-new', surgeryRequestQuota: 10 }) // gatewayPriceId
        .mockResolvedValueOnce({ id: 'plan-new', surgeryRequestQuota: 10 }); // id
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue({
        id: 'quota-1',
        surgeryRequestsLimit: 40,
        surgeryRequestsUsed: 1,
      });

      await service.syncFromGatewaySubscription(
        buildGatewaySub({
          currentPeriodStart: new Date('2026-02-01'),
        }),
      );

      expect(quotaPeriodRepo.create).not.toHaveBeenCalled();
      expect(quotaPeriodRepo.update).toHaveBeenCalledWith('quota-1', {
        surgeryRequestsLimit: 10,
      });
    });

    it('ignora silenciosamente quando subscription local não é encontrada', async () => {
      subscriptionRepo.findByGatewaySubscriptionId.mockResolvedValue(null);

      await expect(
        service.syncFromGatewaySubscription(buildGatewaySub()),
      ).resolves.toBeUndefined();
      expect(subscriptionRepo.update).not.toHaveBeenCalled();
    });
  });
});
