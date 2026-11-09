import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { MetricsSnapshotService } from './metrics-snapshot.service';

describe('MetricsSnapshotService', () => {
  const now = new Date('2026-10-24T03:30:00Z');

  function build() {
    const metrics = {
      countCreatedBetween: jest.fn().mockResolvedValue(2),
      countCanceledBetween: jest.fn().mockResolvedValue(1),
      upsertSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    const accounts = {
      countClients: jest.fn().mockResolvedValue(40),
      countBySituation: jest.fn().mockResolvedValue([
        { situation: 'trial', count: 5 },
        { situation: 'active', count: 30 },
        { situation: 'internal', count: 2 },
      ]),
      countClientsSeenSince: jest.fn((since: Date) =>
        Promise.resolve(
          now.getTime() - since.getTime() === 7 * 86400000 ? 22 : 33,
        ),
      ),
    };
    const revenueRepo = {
      findRevenueSubscriptions: jest.fn().mockResolvedValue([
        {
          status: SubscriptionStatus.ACTIVE,
          trialEndsAt: null,
          plan: { priceCents: 29900, billingPeriod: 'MONTHLY' },
        },
        {
          status: SubscriptionStatus.ACTIVE,
          trialEndsAt: null,
          plan: { priceCents: 299000, billingPeriod: 'YEARLY' },
        },
        {
          status: SubscriptionStatus.INTERNAL,
          trialEndsAt: null,
          plan: { priceCents: 29900, billingPeriod: 'MONTHLY' },
        },
      ] as Subscription[]),
    };
    const service = new MetricsSnapshotService(
      metrics as never,
      accounts as never,
      revenueRepo as never,
    );
    return { service, metrics, accounts };
  }

  it('às 00:30 de 24/10 em SP grava o dia 23/10 com os números à mão', async () => {
    const { service, metrics } = build();

    const row = await service.snapshotPreviousDay(now);

    expect(metrics.countCreatedBetween).toHaveBeenCalledWith({
      from: new Date('2026-10-23T03:00:00Z'),
      to: new Date('2026-10-24T03:00:00Z'),
    });
    expect(metrics.countCanceledBetween).toHaveBeenCalledWith({
      from: new Date('2026-10-23T03:00:00Z'),
      to: new Date('2026-10-24T03:00:00Z'),
    });
    expect(row).toEqual({
      day: '2026-10-23',
      accountsTotal: 40,
      accountsBySituation: {
        trial: 5,
        trial_expired: 0,
        active: 30,
        cancel_scheduled: 0,
        past_due: 0,
        suspended: 0,
        canceled: 0,
        internal: 2,
        deactivated: 0,
      },
      mrrCents: 29900 + 24916,
      payingAccounts: 2,
      trialAccounts: 5,
      newAccounts: 2,
      canceledAccounts: 1,
      activeAccounts7d: 22,
      activeAccounts30d: 33,
    });
    expect(metrics.upsertSnapshot).toHaveBeenCalledWith(row);
  });

  it('rodar duas vezes no mesmo dia regrava a mesma linha (upsert por dia)', async () => {
    const { service, metrics } = build();

    await service.snapshotPreviousDay(now);
    await service.snapshotPreviousDay(new Date('2026-10-24T05:00:00Z'));

    expect(metrics.upsertSnapshot).toHaveBeenCalledTimes(2);
    expect(metrics.upsertSnapshot.mock.calls[0][0].day).toBe('2026-10-23');
    expect(metrics.upsertSnapshot.mock.calls[1][0].day).toBe('2026-10-23');
  });

  it('o cron não propaga erro', async () => {
    const { service, accounts } = build();
    accounts.countClients.mockRejectedValue(new Error('db fora'));

    await expect(service.handleDailySnapshot()).resolves.toBeUndefined();
  });

  it('o cron roda às 00:30 no fuso de São Paulo', () => {
    const meta = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      MetricsSnapshotService.prototype.handleDailySnapshot,
    ) as { cronTime: string; timeZone: string };

    expect(meta).toMatchObject({
      cronTime: '30 0 * * *',
      timeZone: 'America/Sao_Paulo',
    });
  });
});
