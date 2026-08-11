import { NotFoundException } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { BillingRequiredException } from '../billing.exceptions';

describe('QuotaService', () => {
  let service: QuotaService;
  let subscriptionRepo: any;
  let quotaPeriodRepo: any;

  const buildSub = (overrides: Partial<any> = {}) => ({
    id: 'sub-1',
    ownerId: 'owner-1',
    status: SubscriptionStatus.ACTIVE,
    ...overrides,
  });

  const buildPeriod = (overrides: Partial<any> = {}) => ({
    id: 'period-1',
    subscriptionId: 'sub-1',
    surgeryRequestsLimit: 10,
    surgeryRequestsUsed: 0,
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-02-01'),
    ...overrides,
  });

  beforeEach(() => {
    subscriptionRepo = {
      findByOwnerId: jest.fn(),
    };
    quotaPeriodRepo = {
      findCurrentForSubscription: jest.fn(),
      tryConsume: jest.fn(),
      findOne: jest.fn(),
    };
    service = new QuotaService(subscriptionRepo, quotaPeriodRepo);
  });

  describe('assertCanSendSurgeryRequest', () => {
    it('lança quando subscription não existe', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(null);
      await expect(
        service.assertCanSendSurgeryRequest('owner-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança BillingRequiredException quando suspensa', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(
        buildSub({ status: SubscriptionStatus.SUSPENDED }),
      );
      await expect(
        service.assertCanSendSurgeryRequest('owner-1'),
      ).rejects.toThrow(BillingRequiredException);
    });

    it('lança BillingRequiredException quando cota atingida', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsUsed: 10, surgeryRequestsLimit: 10 }),
      );
      await expect(
        service.assertCanSendSurgeryRequest('owner-1'),
      ).rejects.toThrow(BillingRequiredException);
    });

    it('passa quando cota ilimitada (-1)', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsLimit: -1, surgeryRequestsUsed: 99999 }),
      );
      await expect(
        service.assertCanSendSurgeryRequest('owner-1'),
      ).resolves.toBeUndefined();
    });

    it('passa quando trial ativa com cota disponível', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(
        buildSub({ status: SubscriptionStatus.TRIALING }),
      );
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsLimit: 30, surgeryRequestsUsed: 5 }),
      );
      await expect(
        service.assertCanSendSurgeryRequest('owner-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('consumeSurgeryRequest', () => {
    it('chama tryConsume e devolve snapshot atualizado', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsUsed: 3 }),
      );
      quotaPeriodRepo.tryConsume.mockResolvedValue(true);
      quotaPeriodRepo.findOne.mockResolvedValue(
        buildPeriod({ surgeryRequestsUsed: 4 }),
      );

      const snap = await service.consumeSurgeryRequest('owner-1');
      expect(snap.used).toBe(4);
      expect(snap.remaining).toBe(6);
      expect(quotaPeriodRepo.tryConsume).toHaveBeenCalledWith('period-1');
    });

    it('lança quando race condition esgota cota entre assert e consume', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsUsed: 9 }),
      );
      quotaPeriodRepo.tryConsume.mockResolvedValue(false);

      await expect(service.consumeSurgeryRequest('owner-1')).rejects.toThrow(
        BillingRequiredException,
      );
    });

    it('não chama tryConsume quando cota é ilimitada', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsLimit: -1, surgeryRequestsUsed: 5 }),
      );
      quotaPeriodRepo.findOne.mockResolvedValue(
        buildPeriod({ surgeryRequestsLimit: -1, surgeryRequestsUsed: 5 }),
      );

      const snap = await service.consumeSurgeryRequest('owner-1');
      expect(snap.isUnlimited).toBe(true);
      expect(quotaPeriodRepo.tryConsume).not.toHaveBeenCalled();
    });
  });

  describe('getQuotaStatus', () => {
    it('devolve null quando a conta não tem assinatura', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(null);
      await expect(service.getQuotaStatus('owner-1')).resolves.toBeNull();
    });

    it('devolve null quando não há período de cota ativo', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(null);
      await expect(service.getQuotaStatus('owner-1')).resolves.toBeNull();
    });

    it('devolve o consumo do ciclo corrente', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsLimit: 20, surgeryRequestsUsed: 17 }),
      );

      await expect(service.getQuotaStatus('owner-1')).resolves.toEqual({
        used: 17,
        limit: 20,
        isUnlimited: false,
        remaining: 3,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-02-01'),
      });
    });

    it('devolve remaining null (e não Infinity) quando ilimitado', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(buildSub());
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod({ surgeryRequestsLimit: -1, surgeryRequestsUsed: 42 }),
      );

      const status = await service.getQuotaStatus('owner-1');

      expect(status).toMatchObject({ isUnlimited: true, remaining: null });
      // Infinity vira `null` no JSON.stringify — o cliente já recebia nulo,
      // só que tipado como `number`. Aqui o contrato é honesto.
      expect(JSON.parse(JSON.stringify(status)).remaining).toBeNull();
    });

    it('não vaza campos de cobrança (preço, status, gateway)', async () => {
      subscriptionRepo.findByOwnerId.mockResolvedValue(
        buildSub({ gatewayProvider: 'stripe', gatewayCustomerId: 'cus_1' }),
      );
      quotaPeriodRepo.findCurrentForSubscription.mockResolvedValue(
        buildPeriod(),
      );

      const status = await service.getQuotaStatus('owner-1');

      expect(Object.keys(status!).sort()).toEqual([
        'isUnlimited',
        'limit',
        'periodEnd',
        'periodStart',
        'remaining',
        'used',
      ]);
    });
  });
});
