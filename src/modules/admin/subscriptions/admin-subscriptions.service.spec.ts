import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { BillingWebhookService } from 'src/modules/billing/services/billing-webhook.service';
import { SubscriptionService } from 'src/modules/billing/services/subscription.service';
import { PaymentGatewayError } from 'src/shared/payment-gateway/payment-gateway.interface';
import { GatewaySubscription } from 'src/shared/payment-gateway/payment-gateway.types';
import { AdminSubscriptionsService } from './admin-subscriptions.service';

const NOW = new Date('2026-10-24T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const OWNER = 'owner-1';
const ACTOR = 'admin-1';
const REASON = 'Cliente pediu mais prazo para avaliar';

interface FakeSub {
  id: string;
  ownerId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  pastDueSince: Date | null;
  suspendedAt: Date | null;
  canceledAt: Date | null;
  cancelAtPeriodEnd: boolean;
  gatewayProvider: string;
  gatewayCustomerId: string | null;
  gatewaySubscriptionId: string | null;
  internalAccessGrantedBy: string | null;
  internalAccessGrantedAt: Date | null;
}

interface FakePeriod {
  id: string;
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  surgeryRequestsLimit: number;
  surgeryRequestsUsed: number;
}

interface FakeManager {
  writes: Array<() => void>;
  release?: () => void;
}

function gatewaySub(
  overrides: Partial<GatewaySubscription> = {},
): GatewaySubscription {
  return {
    id: 'gw-sub-1',
    customerId: 'cus-1',
    status: 'active',
    providerStatus: 'trialing',
    cycle: 'MONTHLY',
    amountCents: 19900,
    nextDueDate: null,
    priceId: 'price_starter',
    currentPeriodStart: new Date('2026-10-10T12:00:00.000Z'),
    currentPeriodEnd: new Date('2026-10-30T12:00:00.000Z'),
    trialEndsAt: new Date('2026-10-30T12:00:00.000Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  };
}

function buildHarness(initial: Partial<FakeSub> = {}) {
  const state: { sub: FakeSub; periods: FakePeriod[] } = {
    sub: {
      id: 'sub-1',
      ownerId: OWNER,
      planId: 'plan-1',
      status: SubscriptionStatus.TRIALING,
      trialEndsAt: new Date('2026-10-30T12:00:00.000Z'),
      currentPeriodStart: new Date('2026-10-15T12:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-30T12:00:00.000Z'),
      pastDueSince: null,
      suspendedAt: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      gatewayProvider: 'stripe',
      gatewayCustomerId: null,
      gatewaySubscriptionId: null,
      internalAccessGrantedBy: null,
      internalAccessGrantedAt: null,
      ...initial,
    },
    periods: [],
  };

  let lockChain: Promise<void> = Promise.resolve();
  let failCommit = false;

  const dataSource = {
    transaction: jest.fn(
      async <T>(fn: (m: FakeManager) => Promise<T>): Promise<T> => {
        const manager: FakeManager = { writes: [] };
        try {
          const result = await fn(manager);
          if (failCommit) throw new Error('commit falhou');
          manager.writes.forEach((w) => w());
          return result;
        } finally {
          manager.release?.();
        }
      },
    ),
  };

  const subscriptionRepo = {
    lockByOwnerId: jest.fn(async (ownerId: string, manager: FakeManager) => {
      const previous = lockChain;
      lockChain = new Promise<void>((resolve) => {
        manager.release = resolve;
      });
      await previous;
      if (ownerId !== state.sub.ownerId) return null;
      return { ...state.sub };
    }),
    updateWithManager: jest.fn(
      (id: string, data: Partial<FakeSub>, manager: FakeManager) => {
        manager.writes.push(() => {
          state.sub = { ...state.sub, ...data };
        });
        return Promise.resolve();
      },
    ),
    findByGatewaySubscriptionId: jest.fn((gwId: string) =>
      Promise.resolve(
        state.sub.gatewaySubscriptionId === gwId ? { ...state.sub } : null,
      ),
    ),
    update: jest.fn((id: string, data: Partial<FakeSub>) => {
      state.sub = { ...state.sub, ...data };
      return Promise.resolve({ ...state.sub });
    }),
    updateUnlessInternal: jest.fn((id: string, data: Partial<FakeSub>) => {
      if (state.sub.status === SubscriptionStatus.INTERNAL) {
        return Promise.resolve(false);
      }
      state.sub = { ...state.sub, ...data };
      return Promise.resolve(true);
    }),
    findByOwnerId: jest.fn((ownerId: string) =>
      Promise.resolve(ownerId === state.sub.ownerId ? { ...state.sub } : null),
    ),
  };

  const current = (at: Date) =>
    state.periods.find(
      (p) =>
        p.periodStart.getTime() <= at.getTime() &&
        p.periodEnd.getTime() > at.getTime(),
    ) ?? null;

  const quotaPeriodRepo = {
    findCurrentForSubscription: jest.fn((_: string, at: Date) =>
      Promise.resolve(current(at) ? { ...current(at)! } : null),
    ),
    extendPeriodEnd: jest.fn(
      (id: string, periodEnd: Date, manager: FakeManager) => {
        manager.writes.push(() => {
          state.periods = state.periods.map((p) =>
            p.id === id ? { ...p, periodEnd } : p,
          );
        });
        return Promise.resolve();
      },
    ),
    insertWithManager: jest.fn(
      (data: Omit<FakePeriod, 'id'>, manager: FakeManager) => {
        const created = { id: `period-${state.periods.length + 1}`, ...data };
        manager.writes.push(() => {
          state.periods = [...state.periods, created];
        });
        return Promise.resolve(created);
      },
    ),
    closeCurrentPeriods: jest.fn(
      (subscriptionId: string, at: Date, manager: FakeManager) => {
        manager.writes.push(() => {
          state.periods = state.periods.map((p) =>
            p.subscriptionId === subscriptionId &&
            p.periodStart.getTime() <= at.getTime() &&
            p.periodEnd.getTime() > at.getTime()
              ? { ...p, periodEnd: at }
              : p,
          );
        });
        return Promise.resolve();
      },
    ),
    create: jest.fn(),
    update: jest.fn(),
  };

  const planRepo = {
    findOne: jest.fn(() =>
      Promise.resolve({
        id: 'plan-1',
        surgeryRequestQuota: 30,
        gatewayPriceId: 'price_starter',
      }),
    ),
  };

  const audit = {
    begin: jest.fn(() => Promise.resolve({ id: 'log-1' })),
    succeed: jest.fn(() => Promise.resolve()),
    fail: jest.fn(() => Promise.resolve()),
  };

  const gateway = {
    providerId: 'stripe' as const,
    getSubscription: jest.fn(() => Promise.resolve(null)),
    getLatestSubscriptionByCustomer: jest.fn(() => Promise.resolve(null)),
    updateTrialEnd: jest.fn((id: string, trialEnd: Date) =>
      Promise.resolve(
        gatewaySub({
          id,
          trialEndsAt: new Date(Math.floor(trialEnd.getTime() / 1000) * 1000),
          currentPeriodEnd: new Date(
            Math.floor(trialEnd.getTime() / 1000) * 1000,
          ),
        }),
      ),
    ),
  };

  const service = new AdminSubscriptionsService(
    dataSource as never,
    subscriptionRepo as never,
    planRepo as never,
    quotaPeriodRepo as never,
    audit as never,
    gateway as never,
  );

  return {
    state,
    service,
    dataSource,
    subscriptionRepo,
    quotaPeriodRepo,
    planRepo,
    audit,
    gateway,
    failNextCommit: () => {
      failCommit = true;
    },
  };
}

function addPeriod(
  h: ReturnType<typeof buildHarness>,
  overrides: Partial<FakePeriod> = {},
): FakePeriod {
  const period: FakePeriod = {
    id: 'period-0',
    subscriptionId: 'sub-1',
    periodStart: h.state.sub.currentPeriodStart,
    periodEnd: h.state.sub.currentPeriodEnd,
    surgeryRequestsLimit: 30,
    surgeryRequestsUsed: 4,
    ...overrides,
  };
  h.state.periods.push(period);
  return period;
}

describe('AdminSubscriptionsService', () => {
  describe('extendTrial', () => {
    it('sem assinatura na Stripe estende só no banco, a partir do término atual', async () => {
      const h = buildHarness();
      addPeriod(h);
      const before = { ...h.state.sub };

      const result = await h.service.extendTrial(
        OWNER,
        ACTOR,
        { days: 10, reason: REASON },
        NOW,
      );

      const expected = new Date('2026-11-09T12:00:00.000Z');
      expect(h.state.sub.trialEndsAt).toEqual(expected);
      expect(h.state.sub.currentPeriodEnd).toEqual(expected);
      expect(h.state.sub.status).toBe(SubscriptionStatus.TRIALING);
      expect(h.state.periods).toHaveLength(1);
      expect(h.state.periods[0].periodEnd).toEqual(expected);
      expect(h.state.periods[0].surgeryRequestsUsed).toBe(4);
      expect(h.gateway.updateTrialEnd).not.toHaveBeenCalled();
      expect(h.audit.begin).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAdminId: ACTOR,
          action: PlatformAuditAction.TRIAL_EXTENDED,
          targetOwnerId: OWNER,
          reason: REASON,
          before: expect.objectContaining({
            status: SubscriptionStatus.TRIALING,
            trialEndsAt: before.trialEndsAt!.toISOString(),
          }),
        }),
      );
      expect(h.audit.succeed).toHaveBeenCalledWith(
        'log-1',
        expect.objectContaining({
          gatewayRef: null,
          after: expect.objectContaining({
            trialEndsAt: expected.toISOString(),
          }),
        }),
      );
      expect(h.audit.fail).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          auditLogId: 'log-1',
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: expected,
          gatewayRef: null,
        }),
      );
    });

    it('com assinatura trialing na Stripe grava o banco antes e altera lá por último, com a chave da auditoria', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
        currentPeriodStart: new Date('2026-10-10T12:00:00.000Z'),
      });
      addPeriod(h);
      h.gateway.getSubscription.mockResolvedValue(gatewaySub() as never);
      h.gateway.getLatestSubscriptionByCustomer.mockResolvedValue(
        gatewaySub() as never,
      );

      const result = await h.service.extendTrial(
        OWNER,
        ACTOR,
        { days: 7, reason: REASON },
        NOW,
      );

      const expected = new Date('2026-11-06T12:00:00.000Z');
      expect(h.gateway.updateTrialEnd).toHaveBeenCalledWith(
        'gw-sub-1',
        expected,
        'log-1',
      );
      expect(
        h.subscriptionRepo.updateWithManager.mock.invocationCallOrder[0],
      ).toBeLessThan(h.gateway.updateTrialEnd.mock.invocationCallOrder[0]);
      expect(
        h.quotaPeriodRepo.extendPeriodEnd.mock.invocationCallOrder[0],
      ).toBeLessThan(h.gateway.updateTrialEnd.mock.invocationCallOrder[0]);
      expect(h.audit.begin.mock.invocationCallOrder[0]).toBeLessThan(
        h.gateway.updateTrialEnd.mock.invocationCallOrder[0],
      );
      expect(h.state.sub.trialEndsAt).toEqual(expected);
      expect(h.state.sub.currentPeriodEnd).toEqual(expected);
      expect(h.state.sub.status).toBe(SubscriptionStatus.ACTIVE);
      expect(h.state.periods[0].periodEnd).toEqual(expected);
      expect(h.audit.succeed).toHaveBeenCalledWith(
        'log-1',
        expect.objectContaining({ gatewayRef: 'gw-sub-1' }),
      );
      expect(result.gatewayRef).toBe('gw-sub-1');
    });

    it('trial vencido sem período vigente cria um período novo com a cota do plano', async () => {
      const h = buildHarness({
        trialEndsAt: new Date('2026-10-01T12:00:00.000Z'),
        currentPeriodStart: new Date('2026-09-16T12:00:00.000Z'),
        currentPeriodEnd: new Date('2026-10-01T12:00:00.000Z'),
      });
      addPeriod(h, { surgeryRequestsUsed: 30 });

      await h.service.extendTrial(
        OWNER,
        ACTOR,
        { days: 15, reason: REASON },
        NOW,
      );

      const expected = new Date(NOW.getTime() + 15 * DAY);
      expect(h.state.sub.trialEndsAt).toEqual(expected);
      expect(h.state.sub.currentPeriodEnd).toEqual(expected);
      expect(h.state.periods).toHaveLength(2);
      expect(h.state.periods[1]).toEqual(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          periodStart: NOW,
          periodEnd: expected,
          surgeryRequestsLimit: 30,
          surgeryRequestsUsed: 0,
        }),
      );
      expect(h.state.periods[0].periodEnd).toEqual(
        new Date('2026-10-01T12:00:00.000Z'),
      );
    });

    it('until só com a data vale até o fim desse dia em São Paulo', async () => {
      const h = buildHarness();
      addPeriod(h);

      await h.service.extendTrial(
        OWNER,
        ACTOR,
        { until: '2026-11-30', reason: REASON },
        NOW,
      );

      expect(h.state.sub.trialEndsAt).toEqual(
        new Date('2026-12-01T02:59:59.000Z'),
      );
    });

    it('trunca o novo término no segundo (a Stripe grava em segundos)', async () => {
      const h = buildHarness({
        trialEndsAt: new Date('2026-10-01T12:00:00.000Z'),
      });
      const now = new Date('2026-10-24T15:00:00.789Z');

      await h.service.extendTrial(
        OWNER,
        ACTOR,
        { days: 1, reason: REASON },
        now,
      );

      expect(h.state.sub.trialEndsAt!.getUTCMilliseconds()).toBe(0);
    });

    describe('limites de days/until', () => {
      it.each([0, 91, 1.5])(
        'days=%p → 400 sem abrir auditoria',
        async (days) => {
          const h = buildHarness();

          await expect(
            h.service.extendTrial(OWNER, ACTOR, { days, reason: REASON }, NOW),
          ).rejects.toThrow(BadRequestException);
          expect(h.audit.begin).not.toHaveBeenCalled();
          expect(h.dataSource.transaction).not.toHaveBeenCalled();
        },
      );

      it('days e until juntos → 400', async () => {
        const h = buildHarness();

        await expect(
          h.service.extendTrial(
            OWNER,
            ACTOR,
            { days: 5, until: '2026-12-01', reason: REASON },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('nem days nem until → 400', async () => {
        const h = buildHarness();

        await expect(
          h.service.extendTrial(OWNER, ACTOR, { reason: REASON }, NOW),
        ).rejects.toThrow(BadRequestException);
      });

      it('until inválido → 400', async () => {
        const h = buildHarness();

        await expect(
          h.service.extendTrial(
            OWNER,
            ACTOR,
            { until: 'amanhã', reason: REASON },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('until antes de amanhã → 400, auditoria failed e nada muda', async () => {
        const h = buildHarness({
          trialEndsAt: new Date('2026-10-01T12:00:00.000Z'),
        });
        const before = { ...h.state.sub };

        await expect(
          h.service.extendTrial(
            OWNER,
            ACTOR,
            { until: '2026-10-25T10:00:00.000Z', reason: REASON },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(h.state.sub).toEqual(before);
        expect(h.audit.fail).toHaveBeenCalledWith(
          'log-1',
          expect.any(String),
          null,
        );
      });

      it('until depois de agora + 730 dias → 400', async () => {
        const h = buildHarness();

        await expect(
          h.service.extendTrial(
            OWNER,
            ACTOR,
            {
              until: new Date(NOW.getTime() + 731 * DAY).toISOString(),
              reason: REASON,
            },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('days que passam de agora + 730 dias → 400', async () => {
        const h = buildHarness({
          trialEndsAt: new Date(NOW.getTime() + 700 * DAY),
        });

        await expect(
          h.service.extendTrial(
            OWNER,
            ACTOR,
            { days: 60, reason: REASON },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('until que não passa do término atual → 400 (não encurta trial)', async () => {
        const h = buildHarness();

        await expect(
          h.service.extendTrial(
            OWNER,
            ACTOR,
            { until: '2026-10-28', reason: REASON },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('até agora + 730 dias exatos é aceito', async () => {
        const h = buildHarness({ trialEndsAt: null });

        await h.service.extendTrial(
          OWNER,
          ACTOR,
          {
            until: new Date(NOW.getTime() + 730 * DAY).toISOString(),
            reason: REASON,
          },
          NOW,
        );

        expect(h.state.sub.trialEndsAt).toEqual(
          new Date(NOW.getTime() + 730 * DAY),
        );
      });
    });

    describe('ação inválida para a situação → 409', () => {
      it.each([
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAST_DUE,
        SubscriptionStatus.SUSPENDED,
        SubscriptionStatus.CANCELED,
        SubscriptionStatus.INTERNAL,
      ])('status local %s sem trial na Stripe', async (status) => {
        const h = buildHarness({ status });
        const before = { ...h.state.sub };

        await expect(
          h.service.extendTrial(OWNER, ACTOR, { days: 5, reason: REASON }, NOW),
        ).rejects.toThrow(ConflictException);
        expect(h.state.sub).toEqual(before);
        expect(h.audit.fail).toHaveBeenCalledWith(
          'log-1',
          expect.any(String),
          null,
        );
        expect(h.audit.succeed).not.toHaveBeenCalled();
      });

      it('assinatura viva na Stripe que não está em trial', async () => {
        const h = buildHarness({
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-1',
        });
        h.gateway.getSubscription.mockResolvedValue(
          gatewaySub({ providerStatus: 'active' }) as never,
        );

        await expect(
          h.service.extendTrial(OWNER, ACTOR, { days: 5, reason: REASON }, NOW),
        ).rejects.toThrow(ConflictException);
        expect(h.gateway.updateTrialEnd).not.toHaveBeenCalled();
      });
    });

    it('Stripe falha → nada muda no banco e a auditoria fica failed', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });
      addPeriod(h);
      h.gateway.getSubscription.mockResolvedValue(gatewaySub() as never);
      h.gateway.updateTrialEnd.mockRejectedValue(
        new PaymentGatewayError('Stripe fora', 'STRIPE_ERROR', 500),
      );
      const before = { ...h.state.sub };
      const periodsBefore = h.state.periods.map((p) => ({ ...p }));

      await expect(
        h.service.extendTrial(OWNER, ACTOR, { days: 5, reason: REASON }, NOW),
      ).rejects.toBeInstanceOf(PaymentGatewayError);

      expect(h.state.sub).toEqual(before);
      expect(h.state.periods).toEqual(periodsBefore);
      expect(h.audit.fail).toHaveBeenCalledWith('log-1', 'Stripe fora', null);
      expect(h.audit.succeed).not.toHaveBeenCalled();
    });

    it('consulta à Stripe falha → 503, nada muda e auditoria failed', async () => {
      const h = buildHarness({
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });
      h.gateway.getSubscription.mockRejectedValue(new Error('timeout'));
      const before = { ...h.state.sub };

      await expect(
        h.service.extendTrial(OWNER, ACTOR, { days: 5, reason: REASON }, NOW),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(h.state.sub).toEqual(before);
      expect(h.audit.fail).toHaveBeenCalled();
    });

    it('banco falha na gravação → a Stripe não é alterada e a auditoria fica failed', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });
      h.gateway.getSubscription.mockResolvedValue(gatewaySub() as never);
      h.subscriptionRepo.updateWithManager.mockRejectedValue(
        new Error('deadlock'),
      );

      await expect(
        h.service.extendTrial(OWNER, ACTOR, { days: 5, reason: REASON }, NOW),
      ).rejects.toThrow('deadlock');

      expect(h.gateway.updateTrialEnd).not.toHaveBeenCalled();
      expect(h.audit.fail).toHaveBeenCalledWith('log-1', 'deadlock', null);
      expect(h.audit.succeed).not.toHaveBeenCalled();
    });

    it('plano da assinatura sumiu → a Stripe não é alterada e nada muda no banco', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
        trialEndsAt: new Date('2026-10-01T12:00:00.000Z'),
        currentPeriodStart: new Date('2026-09-16T12:00:00.000Z'),
        currentPeriodEnd: new Date('2026-10-01T12:00:00.000Z'),
      });
      h.gateway.getSubscription.mockResolvedValue(gatewaySub() as never);
      h.planRepo.findOne.mockResolvedValue(null as never);
      const before = { ...h.state.sub };

      await expect(
        h.service.extendTrial(OWNER, ACTOR, { days: 5, reason: REASON }, NOW),
      ).rejects.toThrow(NotFoundException);

      expect(h.gateway.updateTrialEnd).not.toHaveBeenCalled();
      expect(h.state.sub).toEqual(before);
      expect(h.state.periods).toHaveLength(0);
    });

    it('Stripe devolve um término diferente → o banco fica com o valor da Stripe', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
        currentPeriodStart: new Date('2026-10-10T12:00:00.000Z'),
      });
      addPeriod(h);
      h.gateway.getSubscription.mockResolvedValue(gatewaySub() as never);
      const stripeEnd = new Date('2026-11-07T12:00:00.000Z');
      h.gateway.updateTrialEnd.mockResolvedValue(
        gatewaySub({
          id: 'gw-sub-1',
          trialEndsAt: stripeEnd,
          currentPeriodEnd: stripeEnd,
        }),
      );

      const result = await h.service.extendTrial(
        OWNER,
        ACTOR,
        { days: 7, reason: REASON },
        NOW,
      );

      expect(h.state.sub.trialEndsAt).toEqual(stripeEnd);
      expect(h.state.sub.currentPeriodEnd).toEqual(stripeEnd);
      expect(h.state.periods[0].periodEnd).toEqual(stripeEnd);
      expect(result.trialEndsAt).toEqual(stripeEnd);
    });

    it('commit falha depois da Stripe → auditoria failed com gatewayRef', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });
      h.gateway.getSubscription.mockResolvedValue(gatewaySub() as never);
      h.failNextCommit();
      const before = { ...h.state.sub };

      await expect(
        h.service.extendTrial(OWNER, ACTOR, { days: 5, reason: REASON }, NOW),
      ).rejects.toThrow('commit falhou');

      expect(h.state.sub).toEqual(before);
      expect(h.audit.fail).toHaveBeenCalledWith(
        'log-1',
        'commit falhou',
        'gw-sub-1',
      );
    });

    it('duas extensões concorrentes somam (a segunda vê o término novo)', async () => {
      const h = buildHarness();
      addPeriod(h);
      let ids = 0;
      h.audit.begin.mockImplementation(() =>
        Promise.resolve({ id: `log-${++ids}` }),
      );

      await Promise.all([
        h.service.extendTrial(OWNER, ACTOR, { days: 10, reason: REASON }, NOW),
        h.service.extendTrial(OWNER, ACTOR, { days: 10, reason: REASON }, NOW),
      ]);

      const expected = new Date('2026-11-19T12:00:00.000Z');
      expect(h.state.sub.trialEndsAt).toEqual(expected);
      expect(h.state.periods[0].periodEnd).toEqual(expected);
      expect(h.audit.succeed).toHaveBeenCalledTimes(2);
    });

    it('conta inexistente → 404 sem auditoria', async () => {
      const h = buildHarness();

      await expect(
        h.service.extendTrial('outra', ACTOR, { days: 5, reason: REASON }, NOW),
      ).rejects.toThrow(NotFoundException);
      expect(h.audit.begin).not.toHaveBeenCalled();
    });

    it('o webhook customer.subscription.updated que chega depois deixa o banco igual', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
        currentPeriodStart: new Date('2026-10-10T12:00:00.000Z'),
      });
      addPeriod(h);
      h.gateway.getSubscription.mockResolvedValue(gatewaySub() as never);

      await h.service.extendTrial(
        OWNER,
        ACTOR,
        { days: 7, reason: REASON },
        NOW,
      );
      const afterAction = JSON.parse(JSON.stringify(h.state)) as unknown;

      const stripeNow = gatewaySub({
        trialEndsAt: new Date('2026-11-06T12:00:00.000Z'),
        currentPeriodEnd: new Date('2026-11-06T12:00:00.000Z'),
      });
      const webhookGateway = {
        providerId: 'stripe',
        verifyWebhook: jest.fn(),
        parseWebhookEvent: jest.fn(() => ({
          eventId: 'evt_trial_updated',
          type: 'subscription.updated',
          resourceId: 'gw-sub-1',
          occurredAt: NOW,
          raw: {},
          refs: { subscriptionId: 'gw-sub-1', customerId: 'cus-1' },
        })),
        getSubscription: jest.fn(() => Promise.resolve(stripeNow)),
      };
      const subscriptionService = new SubscriptionService(
        h.subscriptionRepo as never,
        h.planRepo as never,
        h.quotaPeriodRepo as never,
        { findOne: jest.fn() } as never,
        { get: jest.fn((_: string, d: unknown) => d) } as never,
        webhookGateway as never,
      );
      const eventRepo = {
        findByProviderEvent: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'stored-1' })),
        findOne: jest.fn(() => Promise.resolve(null)),
        update: jest.fn(() => Promise.resolve()),
      };
      const webhook = new BillingWebhookService(
        h.subscriptionRepo as never,
        eventRepo as never,
        subscriptionService,
        webhookGateway as never,
        { upsertFromGateway: jest.fn(() => Promise.resolve()) } as never,
        {
          acquire: jest.fn(() => Promise.resolve('tok')),
          release: jest.fn(() => Promise.resolve()),
        } as never,
      );

      await webhook.handle({ payload: Buffer.from('{}'), headers: {} });

      expect(JSON.parse(JSON.stringify(h.state))).toEqual(afterAction);
      expect(h.quotaPeriodRepo.create).not.toHaveBeenCalled();
      expect(h.quotaPeriodRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('grantInternalAccess', () => {
    it('sem cadastro na Stripe libera, grava autor e data e limpa as datas de cobrança', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date('2026-09-01T00:00:00.000Z'),
        pastDueSince: new Date('2026-08-01T00:00:00.000Z'),
        suspendedAt: new Date('2026-08-10T00:00:00.000Z'),
      });

      const result = await h.service.grantInternalAccess(
        OWNER,
        ACTOR,
        { reason: 'Conta de testes da equipe' },
        NOW,
      );

      expect(h.state.sub).toEqual(
        expect.objectContaining({
          status: SubscriptionStatus.INTERNAL,
          internalAccessGrantedBy: ACTOR,
          internalAccessGrantedAt: NOW,
          trialEndsAt: null,
          pastDueSince: null,
          suspendedAt: null,
          canceledAt: null,
        }),
      );
      expect(h.gateway.getSubscription).not.toHaveBeenCalled();
      expect(h.gateway.getLatestSubscriptionByCustomer).not.toHaveBeenCalled();
      expect(h.audit.begin).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PlatformAuditAction.INTERNAL_ACCESS_GRANTED,
          actorAdminId: ACTOR,
          targetOwnerId: OWNER,
          reason: 'Conta de testes da equipe',
        }),
      );
      expect(h.audit.succeed).toHaveBeenCalled();
      expect(result.status).toBe(SubscriptionStatus.INTERNAL);
    });

    it('permitido quando a Stripe só tem assinatura cancelada', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.CANCELED,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-sub-1',
      });
      const canceled = gatewaySub({
        status: 'canceled',
        providerStatus: 'canceled',
      });
      h.gateway.getSubscription.mockResolvedValue(canceled as never);
      h.gateway.getLatestSubscriptionByCustomer.mockResolvedValue(
        canceled as never,
      );

      await h.service.grantInternalAccess(
        OWNER,
        ACTOR,
        { reason: REASON },
        NOW,
      );

      expect(h.gateway.getSubscription).toHaveBeenCalledWith('gw-sub-1');
      expect(h.gateway.getLatestSubscriptionByCustomer).toHaveBeenCalledWith(
        'cus-1',
      );
      expect(h.state.sub.status).toBe(SubscriptionStatus.INTERNAL);
    });

    it('permitido quando há cliente na Stripe sem nenhuma assinatura', async () => {
      const h = buildHarness({ gatewayCustomerId: 'cus-1' });

      await h.service.grantInternalAccess(
        OWNER,
        ACTOR,
        { reason: REASON },
        NOW,
      );

      expect(h.state.sub.status).toBe(SubscriptionStatus.INTERNAL);
    });

    it.each([
      'trialing',
      'active',
      'past_due',
      'unpaid',
      'incomplete',
      'paused',
    ])(
      'negado com assinatura %s na Stripe (409) e nada muda',
      async (providerStatus) => {
        const h = buildHarness({
          gatewayCustomerId: 'cus-1',
          gatewaySubscriptionId: 'gw-sub-1',
        });
        h.gateway.getSubscription.mockResolvedValue(
          gatewaySub({ providerStatus }) as never,
        );
        const before = { ...h.state.sub };

        await expect(
          h.service.grantInternalAccess(OWNER, ACTOR, { reason: REASON }, NOW),
        ).rejects.toThrow(
          new ConflictException(
            'Conta com assinatura na Stripe não pode receber acesso interno.',
          ),
        );
        expect(h.state.sub).toEqual(before);
        expect(h.audit.fail).toHaveBeenCalledWith(
          'log-1',
          'Conta com assinatura na Stripe não pode receber acesso interno.',
          null,
        );
      },
    );

    it('negado quando a assinatura viva só aparece pelo cliente', async () => {
      const h = buildHarness({
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-old',
      });
      h.gateway.getSubscription.mockResolvedValue(
        gatewaySub({
          id: 'gw-old',
          status: 'canceled',
          providerStatus: 'canceled',
        }) as never,
      );
      h.gateway.getLatestSubscriptionByCustomer.mockResolvedValue(
        gatewaySub({ id: 'gw-new', providerStatus: 'active' }) as never,
      );

      await expect(
        h.service.grantInternalAccess(OWNER, ACTOR, { reason: REASON }, NOW),
      ).rejects.toThrow(ConflictException);
    });

    it('sem providerStatus, trata status normalizado não cancelado como viva', async () => {
      const h = buildHarness({ gatewaySubscriptionId: 'gw-sub-1' });
      h.gateway.getSubscription.mockResolvedValue(
        gatewaySub({
          providerStatus: undefined,
          status: 'incomplete',
        }) as never,
      );

      await expect(
        h.service.grantInternalAccess(OWNER, ACTOR, { reason: REASON }, NOW),
      ).rejects.toThrow(ConflictException);
    });

    it('erro ao consultar a Stripe recusa (fail-closed), 503 e auditoria failed', async () => {
      const h = buildHarness({ gatewayCustomerId: 'cus-1' });
      h.gateway.getLatestSubscriptionByCustomer.mockRejectedValue(
        new PaymentGatewayError('rate limit', 'rate_limit', 429),
      );
      const before = { ...h.state.sub };

      await expect(
        h.service.grantInternalAccess(OWNER, ACTOR, { reason: REASON }, NOW),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(h.state.sub).toEqual(before);
      expect(h.audit.fail).toHaveBeenCalledWith(
        'log-1',
        expect.stringContaining('Stripe'),
        null,
      );
    });

    it('conta que já tem acesso interno → 409', async () => {
      const h = buildHarness({ status: SubscriptionStatus.INTERNAL });

      await expect(
        h.service.grantInternalAccess(OWNER, ACTOR, { reason: REASON }, NOW),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('revokeInternalAccess', () => {
    const internal = {
      status: SubscriptionStatus.INTERNAL,
      trialEndsAt: null,
      internalAccessGrantedBy: 'admin-0',
      internalAccessGrantedAt: new Date('2026-10-01T00:00:00.000Z'),
    };

    it('volta para trial de 15 dias (padrão) com período de cota novo', async () => {
      const h = buildHarness(internal);
      addPeriod(h, {
        periodStart: new Date('2026-10-20T00:00:00.000Z'),
        periodEnd: new Date('2026-11-05T00:00:00.000Z'),
        surgeryRequestsUsed: 9,
      });

      await h.service.revokeInternalAccess(
        OWNER,
        ACTOR,
        { to: 'trial', reason: REASON },
        NOW,
      );

      const trialEnd = new Date(NOW.getTime() + 15 * DAY);
      expect(h.state.sub).toEqual(
        expect.objectContaining({
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: trialEnd,
          currentPeriodStart: NOW,
          currentPeriodEnd: trialEnd,
          internalAccessGrantedBy: null,
          internalAccessGrantedAt: null,
          canceledAt: null,
        }),
      );
      expect(h.state.periods[0].periodEnd).toEqual(NOW);
      expect(h.state.periods[1]).toEqual(
        expect.objectContaining({
          periodStart: NOW,
          periodEnd: trialEnd,
          surgeryRequestsLimit: 30,
          surgeryRequestsUsed: 0,
        }),
      );
      expect(h.audit.begin).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PlatformAuditAction.INTERNAL_ACCESS_REVOKED,
        }),
      );
      expect(h.audit.succeed).toHaveBeenCalled();
    });

    it('respeita trialDays', async () => {
      const h = buildHarness(internal);

      await h.service.revokeInternalAccess(
        OWNER,
        ACTOR,
        { to: 'trial', trialDays: 30, reason: REASON },
        NOW,
      );

      expect(h.state.sub.trialEndsAt).toEqual(
        new Date(NOW.getTime() + 30 * DAY),
      );
    });

    it('cancelar deixa a conta cancelada sem criar período', async () => {
      const h = buildHarness(internal);

      await h.service.revokeInternalAccess(
        OWNER,
        ACTOR,
        { to: 'canceled', reason: REASON },
        NOW,
      );

      expect(h.state.sub).toEqual(
        expect.objectContaining({
          status: SubscriptionStatus.CANCELED,
          canceledAt: NOW,
          internalAccessGrantedBy: null,
          internalAccessGrantedAt: null,
        }),
      );
      expect(h.quotaPeriodRepo.insertWithManager).not.toHaveBeenCalled();
    });

    it('conta sem acesso interno → 409 e auditoria failed', async () => {
      const h = buildHarness();

      await expect(
        h.service.revokeInternalAccess(
          OWNER,
          ACTOR,
          { to: 'canceled', reason: REASON },
          NOW,
        ),
      ).rejects.toThrow(ConflictException);
      expect(h.audit.fail).toHaveBeenCalled();
    });

    it.each([0, 91])('trialDays=%p → 400', async (trialDays) => {
      const h = buildHarness(internal);

      await expect(
        h.service.revokeInternalAccess(
          OWNER,
          ACTOR,
          { to: 'trial', trialDays, reason: REASON },
          NOW,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('destino inválido → 400', async () => {
      const h = buildHarness(internal);

      await expect(
        h.service.revokeInternalAccess(
          OWNER,
          ACTOR,
          { to: 'active' as never, reason: REASON },
          NOW,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('motivo obrigatório (5 a 500 caracteres)', () => {
    it.each([undefined, '', '   ', 'abc', 'x'.repeat(501)])(
      'motivo %p → 400 nas três ações, sem auditoria',
      async (reason) => {
        const h = buildHarness();

        await expect(
          h.service.extendTrial(
            OWNER,
            ACTOR,
            { days: 5, reason: reason as string },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          h.service.grantInternalAccess(
            OWNER,
            ACTOR,
            { reason: reason as string },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          h.service.revokeInternalAccess(
            OWNER,
            ACTOR,
            { to: 'canceled', reason: reason as string },
            NOW,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(h.audit.begin).not.toHaveBeenCalled();
      },
    );

    it('grava o motivo sem espaços nas pontas', async () => {
      const h = buildHarness();

      await h.service.grantInternalAccess(
        OWNER,
        ACTOR,
        { reason: '  testes internos  ' },
        NOW,
      );

      expect(h.audit.begin).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'testes internos' }),
      );
    });
  });

  describe('a tela do cliente não desfaz o trial local (reconciliação)', () => {
    function clientView(
      h: ReturnType<typeof buildHarness>,
      stripe: {
        byId?: GatewaySubscription | null;
        latest?: GatewaySubscription | null;
      },
    ) {
      const clientGateway = {
        providerId: 'stripe',
        getSubscription: jest.fn(() => Promise.resolve(stripe.byId ?? null)),
        getLatestSubscriptionByCustomer: jest.fn(() =>
          Promise.resolve(stripe.latest ?? null),
        ),
      };
      return new SubscriptionService(
        h.subscriptionRepo as never,
        h.planRepo as never,
        h.quotaPeriodRepo as never,
        {
          findOne: jest.fn(() =>
            Promise.resolve({ id: OWNER, ownerId: OWNER }),
          ),
        } as never,
        { get: jest.fn((_: string, d: unknown) => d) } as never,
        clientGateway as never,
      );
    }

    const internalWithCustomer = {
      status: SubscriptionStatus.INTERNAL,
      trialEndsAt: null,
      gatewayCustomerId: 'cus-1',
      internalAccessGrantedBy: 'admin-0',
      internalAccessGrantedAt: new Date('2026-10-01T00:00:00.000Z'),
    };

    it('revoke→trial com cliente na Stripe sem assinatura continua TRIALING', async () => {
      const h = buildHarness(internalWithCustomer);

      await h.service.revokeInternalAccess(
        OWNER,
        ACTOR,
        { to: 'trial', reason: REASON },
        NOW,
      );
      const result = await clientView(h, {}).getMySubscription(OWNER);

      expect(result.subscription.status).toBe(SubscriptionStatus.TRIALING);
      expect(h.state.sub.status).toBe(SubscriptionStatus.TRIALING);
    });

    it('revoke→trial com só assinatura cancelada na Stripe continua TRIALING', async () => {
      const h = buildHarness({
        ...internalWithCustomer,
        gatewaySubscriptionId: 'gw-old',
      });
      const canceled = gatewaySub({
        id: 'gw-old',
        status: 'canceled',
        providerStatus: 'canceled',
        canceledAt: new Date('2026-09-01T00:00:00.000Z'),
      });

      await h.service.revokeInternalAccess(
        OWNER,
        ACTOR,
        { to: 'trial', reason: REASON },
        NOW,
      );
      const result = await clientView(h, {
        byId: canceled,
        latest: canceled,
      }).getMySubscription(OWNER);

      expect(result.subscription.status).toBe(SubscriptionStatus.TRIALING);
      expect(h.state.sub.canceledAt).toBeNull();
    });

    it('extend-trial em trial local com cliente na Stripe continua TRIALING com o novo término', async () => {
      const h = buildHarness({ gatewayCustomerId: 'cus-1' });
      addPeriod(h);

      await h.service.extendTrial(
        OWNER,
        ACTOR,
        { days: 10, reason: REASON },
        NOW,
      );
      const result = await clientView(h, {}).getMySubscription(OWNER);

      expect(result.subscription.status).toBe(SubscriptionStatus.TRIALING);
      expect(result.subscription.trialEndsAt).toEqual(
        new Date('2026-11-09T12:00:00.000Z'),
      );
    });

    it('regressão: ACTIVE com assinatura cancelada na Stripe vira CANCELED', async () => {
      const h = buildHarness({
        status: SubscriptionStatus.ACTIVE,
        gatewayCustomerId: 'cus-1',
        gatewaySubscriptionId: 'gw-old',
      });
      const canceled = gatewaySub({
        id: 'gw-old',
        status: 'canceled',
        providerStatus: 'canceled',
        canceledAt: new Date('2026-09-01T00:00:00.000Z'),
      });

      const result = await clientView(h, {
        byId: canceled,
        latest: canceled,
      }).getMySubscription(OWNER);

      expect(result.subscription.status).toBe(SubscriptionStatus.CANCELED);
    });
  });
});
