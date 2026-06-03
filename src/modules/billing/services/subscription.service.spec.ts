import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let subscriptionRepo: any;
  let planRepo: any;
  let quotaPeriodRepo: any;
  let paymentMethodRepo: any;
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
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    planRepo = {
      findOne: jest.fn(),
      findTrialDefault: jest.fn(),
    };
    quotaPeriodRepo = { create: jest.fn() };
    paymentMethodRepo = {};
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
      createSubscription: jest.fn(),
      cancelSubscription: jest.fn().mockResolvedValue(undefined),
    };

    service = new SubscriptionService(
      subscriptionRepo,
      planRepo,
      quotaPeriodRepo,
      paymentMethodRepo,
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
  });

  describe('changePlan', () => {
    it('agenda nextPlanId para troca no próximo ciclo', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        ownerId: 'owner-1',
        status: SubscriptionStatus.ACTIVE,
        planId: 'plan-current',
      });
      planRepo.findOne.mockResolvedValue({
        id: 'plan-new',
        isActive: true,
      });
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        nextPlanId: 'plan-new',
        planId: 'plan-current',
      });

      const result = await service.changePlan('owner-1', 'plan-new');

      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        nextPlanId: 'plan-new',
      });
      expect(result.nextPlanId).toBe('plan-new');
    });

    it('proíbe colaborador (não-owner) de trocar plano', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        ownerId: 'owner-1', // diferente
      });
      await expect(service.changePlan('user-1', 'plan-new')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('cancelAtPeriodEnd', () => {
    it('marca cancel_at_period_end=true e mantém status', async () => {
      userRepo.findOne.mockResolvedValue(buildOwner());
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: false,
      });
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: true,
      });

      const result = await service.cancelAtPeriodEnd('owner-1');

      expect(subscriptionRepo.update).toHaveBeenCalledWith('sub-1', {
        cancelAtPeriodEnd: true,
      });
      expect(result.cancelAtPeriodEnd).toBe(true);
    });
  });

  describe('cancelImmediately', () => {
    it('cancela no gateway (atPeriodEnd=false) e marca CANCELED localmente', async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });

      await service.cancelImmediately('sub-1');

      expect(gateway.cancelSubscription).toHaveBeenCalledWith('gw-sub-1', {
        atPeriodEnd: false,
      });
      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
      );
    });

    it('não falha se gateway lança (apenas loga)', async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });
      gateway.cancelSubscription.mockRejectedValue(new Error('boom'));

      await expect(service.cancelImmediately('sub-1')).resolves.toBeUndefined();
      expect(subscriptionRepo.update).toHaveBeenCalled();
    });
  });

  describe('advanceBillingPeriod', () => {
    it('cria novo período de cota e ativa nextPlan se agendado', async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-old',
        nextPlanId: 'plan-new',
        currentPeriodEnd: new Date('2026-02-01'),
      });
      planRepo.findOne.mockResolvedValue({
        id: 'plan-new',
        billingPeriod: 'MONTHLY',
        surgeryRequestQuota: 100,
      });

      await service.advanceBillingPeriod('sub-1');

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({
          status: SubscriptionStatus.ACTIVE,
          planId: 'plan-new',
          nextPlanId: null,
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

  describe('onPaymentMethodAdded', () => {
    it('em TRIALING cria subscription no gateway e vincula ao trial', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-1',
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date('2026-02-01'),
      });
      planRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        name: 'Profissional',
        priceCents: 19900,
        billingPeriod: 'MONTHLY',
      });
      gateway.createSubscription.mockResolvedValue({ id: 'gw-sub-1' });

      await service.onPaymentMethodAdded({
        ownerId: 'owner-1',
        paymentMethodId: 'pm-1',
        paymentMethodToken: 'tok-1',
        gatewayCustomerId: 'cus-1',
      });

      expect(gateway.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cus-1',
          paymentMethodToken: 'tok-1',
          amountCents: 19900,
          externalReference: 'sub-1',
        }),
      );
      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-1',
          defaultPaymentMethodId: 'pm-1',
        }),
      );
    });

    it('em SUSPENDED reativa criando assinatura no gateway', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-1',
        status: SubscriptionStatus.SUSPENDED,
        gatewaySubscriptionId: null,
      });
      planRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        name: 'Essencial',
        priceCents: 9900,
        billingPeriod: 'MONTHLY',
      });
      gateway.createSubscription.mockResolvedValue({ id: 'gw-sub-2' });

      await service.onPaymentMethodAdded({
        ownerId: 'owner-1',
        paymentMethodId: 'pm-1',
        paymentMethodToken: 'tok-1',
        gatewayCustomerId: 'cus-1',
      });

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({
          status: SubscriptionStatus.ACTIVE,
          suspendedAt: null,
          pastDueSince: null,
          gatewaySubscriptionId: 'gw-sub-2',
        }),
      );
    });
  });
});
