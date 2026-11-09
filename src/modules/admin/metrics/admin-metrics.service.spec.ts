import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import { AdminMetricsService } from './admin-metrics.service';

const now = new Date('2026-10-24T15:00:00Z');

const sub = (over: Partial<Subscription>): Subscription =>
  ({
    ownerId: 'o',
    status: SubscriptionStatus.ACTIVE,
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-11-10T12:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    gatewaySubscriptionId: 'sub_x',
    discountPercentOff: null,
    discountAmountOffCents: null,
    discountDuration: null,
    discountEndsAt: null,
    owner: { name: 'Clínica', email: 'c@x.com' },
    plan: { priceCents: 29900, billingPeriod: 'MONTHLY' },
    ...over,
  }) as Subscription;

const mensal199 = { priceCents: 19900, billingPeriod: 'MONTHLY' } as never;
const anual2990 = { priceCents: 299000, billingPeriod: 'YEARLY' } as never;

function build() {
  const metrics = {
    countCreatedBetween: jest.fn().mockResolvedValue(5),
    trialCohort: jest.fn(({ from }: { from: Date }) =>
      Promise.resolve(
        from.getTime() === new Date('2026-07-26T15:00:00Z').getTime()
          ? { started: 12, withCard: 7, converted: 3 }
          : { started: 5, withCard: 3, converted: 1 },
      ),
    ),
    findPayingCanceledBetween: jest.fn().mockResolvedValue([
      sub({
        ownerId: 'E',
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date('2026-10-05T12:00:00Z'),
      }),
      sub({
        ownerId: 'F',
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date('2026-10-12T12:00:00Z'),
        plan: anual2990,
      }),
    ]),
    monthlyCreated: jest.fn().mockResolvedValue([
      { month: '2026-09', count: 3 },
      { month: '2026-10', count: 5 },
    ]),
    monthlyCanceled: jest
      .fn()
      .mockResolvedValue([{ month: '2026-10', count: 2 }]),
    accountsByPlan: jest.fn().mockResolvedValue([
      {
        planId: 'p1',
        planName: 'Starter',
        billingPeriod: 'MONTHLY',
        accounts: 4,
      },
    ]),
    findSnapshotsBetween: jest.fn().mockResolvedValue([
      { day: '2026-09-23', mrrCents: 50000, payingAccounts: 6 },
      { day: '2026-09-30', mrrCents: 100000, payingAccounts: 10 },
    ]),
  };
  const accounts = {
    countClients: jest.fn().mockResolvedValue(30),
    countInactiveClients: jest.fn().mockResolvedValue(9),
    countBySituation: jest.fn().mockResolvedValue([
      { situation: 'trial', count: 4 },
      { situation: 'trial_expired', count: 2 },
      { situation: 'active', count: 20 },
      { situation: 'internal', count: 1 },
    ]),
    countClientsSeenSince: jest.fn((since: Date) =>
      Promise.resolve(
        now.getTime() - since.getTime() === 7 * 86400000 ? 18 : 25,
      ),
    ),
    findPage: jest.fn().mockResolvedValue({ items: [], total: 3 }),
  };
  const usage = {
    weeklySurgeryRequestsCreated: jest.fn().mockResolvedValue([
      { weekStart: '2026-09-28', count: 4 },
      { weekStart: '2026-10-05', count: 6 },
    ]),
    weeklyAppointmentsByStatus: jest.fn().mockResolvedValue([
      {
        weekStart: '2026-09-28',
        status: AppointmentStatus.COMPLETED,
        count: 3,
      },
      {
        weekStart: '2026-10-05',
        status: AppointmentStatus.CANCELLED,
        count: 2,
      },
      {
        weekStart: '2026-10-12',
        status: AppointmentStatus.SCHEDULED,
        count: 5,
      },
    ]),
    weeklyPatientsCreated: jest
      .fn()
      .mockResolvedValue([{ weekStart: '2026-10-05', count: 7 }]),
  };
  const revenueRepo = {
    findRevenueSubscriptions: jest.fn().mockResolvedValue([
      sub({ ownerId: 'A' }),
      sub({
        ownerId: 'B',
        plan: anual2990,
        currentPeriodEnd: new Date('2027-05-01T12:00:00Z'),
      }),
      sub({
        ownerId: 'C',
        plan: mensal199,
        trialEndsAt: new Date('2026-11-05T12:00:00Z'),
      }),
      sub({
        ownerId: 'D',
        status: SubscriptionStatus.PAST_DUE,
        plan: mensal199,
        discountPercentOff: 50,
        discountDuration: 'forever',
      }),
    ]),
    sumPaidBetween: jest.fn().mockResolvedValue({
      receivedCents: 53820,
      discountCents: 0,
      invoices: 2,
    }),
  };
  const revenue = {
    getDelinquency: jest
      .fn()
      .mockResolvedValue({ totalOpenCents: 19900, items: [{}] }),
  };
  const ai = {
    costSummary: jest.fn().mockResolvedValue({
      clientMonthUsdCents: 1234,
      platformMonthUsdCents: 1500,
      clientLast30DaysUsdCents: 1400,
    }),
    topOwnersByCost: jest.fn().mockResolvedValue([
      {
        ownerId: 'o1',
        name: 'Clínica A',
        email: 'a@x.com',
        costUsdCents: 900,
        totalTokens: 120000,
      },
    ]),
  };
  const errors = {
    accountsWithSpike: jest.fn().mockResolvedValue({
      accounts: 2,
      top: [{ ownerId: 'o9', ownerName: 'Clínica Z', total: 42 }],
    }),
  };
  const health = {
    ensureFresh: jest.fn().mockResolvedValue(undefined),
    atRisk: jest.fn().mockResolvedValue({
      total: 3,
      items: [
        {
          ownerId: 'o7',
          name: 'Clínica R',
          score: 22,
          factors: [
            {
              key: 'last_seen',
              points: 35,
              message: 'Ninguém da clínica acessa há 40 dias',
            },
            { key: 'errors', points: 8, message: '6 erros' },
          ],
        },
        { ownerId: 'o8', name: 'Clínica S', score: 38, factors: [] },
      ],
    }),
  };
  const activation = {
    cohort: jest.fn().mockResolvedValue({
      cohortAccounts: 4,
      withFirstPatient: 3,
      activated: 2,
      activationRatePercent: 50,
      averageDaysToActivate: 3.5,
      medianDaysToActivate: 3.5,
    }),
  };
  const security = {
    spike: jest.fn().mockResolvedValue({
      accountThreshold: 10,
      platformThreshold: 50,
      platformTotal24h: 14,
      platformSpike: false,
      accountsWithSpike24h: 1,
      topSpikeAccounts: [
        {
          ownerId: 'o9',
          ownerName: 'Clínica T',
          total: 12,
          users: 2,
          lastSeenAt: now,
        },
      ],
    }),
  };
  const service = new AdminMetricsService(
    metrics as never,
    accounts as never,
    usage as never,
    revenueRepo as never,
    revenue as never,
    ai as never,
    errors as never,
    health as never,
    activation as never,
    security as never,
  );
  return {
    service,
    security,
    health,
    activation,
    metrics,
    accounts,
    usage,
    revenueRepo,
    revenue,
    ai,
    errors,
  };
}

describe('AdminMetricsService.getOverview', () => {
  it('segurança: devolve o pico de falhas de login das últimas 24 h', async () => {
    const { service, security } = build();

    const overview = await service.getOverview('30d', now);

    expect(security.spike).toHaveBeenCalledWith(now);
    expect(overview.security.accountsWithSpike24h).toBe(1);
    expect(overview.security.topSpikeAccounts[0].ownerId).toBe('o9');
  });

  it('contas em risco: atualiza a saúde antes e devolve o principal motivo de cada uma', async () => {
    const { service, health } = build();

    const overview = await service.getOverview('30d', now);

    expect(health.ensureFresh).toHaveBeenCalledWith(now);
    expect(health.atRisk).toHaveBeenCalledWith(5);
    expect(overview.accountsAtRisk).toEqual({
      total: 3,
      items: [
        {
          ownerId: 'o7',
          name: 'Clínica R',
          score: 22,
          mainReason: 'Ninguém da clínica acessa há 40 dias',
        },
        { ownerId: 'o8', name: 'Clínica S', score: 38, mainReason: null },
      ],
    });
  });

  it('ativação: coorte das contas cadastradas no período escolhido', async () => {
    const { service, activation } = build();
    const now = new Date('2026-10-24T15:00:00Z');

    const overview = await service.getOverview('30d', now);

    const range = activation.cohort.mock.calls[0][0] as {
      from: Date;
      to: Date;
    };
    expect(range.to).toEqual(now);
    expect(range.from).toEqual(overview.from);
    expect(overview.activation).toEqual({
      cohortAccounts: 4,
      withFirstPatient: 3,
      activated: 2,
      activationRatePercent: 50,
      averageDaysToActivate: 3.5,
      medianDaysToActivate: 3.5,
    });
  });

  it('erros: contas com pico nas últimas 24 h, consultando desde ontem (São Paulo)', async () => {
    const { service, errors } = build();

    const overview = await service.getOverview('30d', now);

    expect(overview.errors).toEqual({
      spikeThreshold: 10,
      accountsWithSpike24h: 2,
      topSpikeAccounts: [{ ownerId: 'o9', ownerName: 'Clínica Z', total: 42 }],
    });
    const [since, fromDay, threshold] = errors.accountsWithSpike.mock.calls[0];
    expect(since).toEqual(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    expect(fromDay).toBe('2026-10-23');
    expect(threshold).toBe(10);
  });

  it('contas: total, novas no período e situação com zeros nas ausentes', async () => {
    const { service, metrics } = build();

    const { accounts } = await service.getOverview('30d', now);

    expect(accounts.total).toBe(30);
    expect(accounts.newInPeriod).toBe(5);
    expect(metrics.countCreatedBetween).toHaveBeenCalledWith({
      from: new Date('2026-09-24T15:00:00Z'),
      to: now,
    });
    expect(accounts.bySituation).toEqual([
      { situation: 'trial', count: 4 },
      { situation: 'trial_expired', count: 2 },
      { situation: 'active', count: 20 },
      { situation: 'cancel_scheduled', count: 0 },
      { situation: 'past_due', count: 0 },
      { situation: 'suspended', count: 0 },
      { situation: 'canceled', count: 0 },
      { situation: 'internal', count: 1 },
      { situation: 'deactivated', count: 0 },
    ]);
  });

  it('trials: ativos 4, terminando em 7 dias 3 (mesmo filtro da lista), vencidos 2, conversão 3 de 12 = 25%', async () => {
    const { service, accounts, metrics } = build();

    const { trials } = await service.getOverview('30d', now);

    expect(trials).toMatchObject({ active: 4, endingIn7Days: 3, expired: 2 });
    expect(accounts.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ trialEndingInDays: 7, now }),
    );
    expect(metrics.trialCohort).toHaveBeenCalledWith({
      from: new Date('2026-07-26T15:00:00Z'),
      to: new Date('2026-10-09T15:00:00Z'),
    });
    expect(trials.conversion90d).toEqual({
      cohortFrom: new Date('2026-07-26T15:00:00Z'),
      cohortTo: new Date('2026-10-09T15:00:00Z'),
      started: 12,
      converted: 3,
      ratePercent: 25,
    });
  });

  it('receita: MRR 299,00 + 2.990,00/12 + 199,00 com 50% = 647,66; trial C conta zero; +29,5% contra 500,00 de 23/09', async () => {
    const { service, metrics } = build();

    const { revenue } = await service.getOverview('30d', now);

    expect(revenue.mrrCents).toBe(29900 + 24916 + 9950);
    expect(revenue.payingAccounts).toBe(3);
    expect(revenue.mrrPreviousCents).toBe(50000);
    expect(revenue.mrrChangePercent).toBe(29.5);
    expect(metrics.findSnapshotsBetween).toHaveBeenCalledWith(
      '2025-11-01',
      '2026-10-24',
    );
  });

  it('receita: recebido no mês, previsão de novembro (299,00 garantido + 199,00 do trial C) marcada como estimativa e inadimplência', async () => {
    const { service, revenueRepo } = build();

    const { revenue } = await service.getOverview('30d', now);

    expect(revenueRepo.sumPaidBetween).toHaveBeenCalledWith(
      new Date('2026-10-01T03:00:00Z'),
      new Date('2026-11-01T03:00:00Z'),
    );
    expect(revenue).toMatchObject({
      month: '2026-10',
      receivedThisMonthCents: 53820,
      nextMonth: '2026-11',
      nextMonthForecastGuaranteedCents: 29900,
      nextMonthForecastTrialConversionCents: 19900,
      nextMonthForecastCents: 49800,
      nextMonthForecastIsEstimate: true,
      delinquentCents: 19900,
      delinquentAccounts: 1,
    });
  });

  it('acesso interno não muda o MRR nem a previsão, mesmo com assinatura na Stripe', async () => {
    const { service, revenueRepo } = build();
    const base = await service.getOverview('30d', now);
    revenueRepo.findRevenueSubscriptions.mockResolvedValue([
      ...(await revenueRepo.findRevenueSubscriptions()),
      sub({ ownerId: 'X', status: SubscriptionStatus.INTERNAL }),
    ]);

    const { revenue } = await service.getOverview('30d', now);

    expect(revenue.mrrCents).toBe(base.revenue.mrrCents);
    expect(revenue.payingAccounts).toBe(base.revenue.payingAccounts);
    expect(revenue.nextMonthForecastCents).toBe(
      base.revenue.nextMonthForecastCents,
    );
  });

  it('churn do mês: 2 pagantes canceladas ÷ 10 pagantes em 30/09 = 20%; MRR perdido 299,00 + 249,16 ÷ 1.000,00 = 54,8%', async () => {
    const { service, metrics } = build();

    const { churn } = await service.getOverview('30d', now);

    expect(metrics.findPayingCanceledBetween).toHaveBeenCalledWith({
      from: new Date('2026-10-01T03:00:00Z'),
      to: now,
    });
    expect(churn).toEqual({
      month: '2026-10',
      canceledAccounts: 2,
      payingAccountsAtStart: 10,
      accountsRatePercent: 20,
      lostMrrCents: 54816,
      mrrAtStartCents: 100000,
      revenueRatePercent: 54.8,
    });
  });

  it('engajamento: ativas 18/25, sem acesso há 7 dias vem de countInactiveClients (9), SCs 4 + 6, consultas 3 + 2 + 5, pacientes 7', async () => {
    const { service, usage } = build();

    const { engagement } = await service.getOverview('30d', now);

    expect(engagement).toEqual({
      activeAccounts7d: 18,
      activeAccounts30d: 25,
      inactiveAccounts7d: 9,
      surgeryRequestsCreated: 10,
      appointments: 10,
      patientsCreated: 7,
    });
    expect(usage.weeklySurgeryRequestsCreated).toHaveBeenCalledWith({
      from: new Date('2026-09-24T15:00:00Z'),
      to: now,
    });
  });

  it('IA em US$: custo do mês das contas cliente, da plataforma e média 1.400 ÷ 25 ativas = 56', async () => {
    const { service, ai } = build();

    const result = await service.getOverview('30d', now);

    expect(ai.costSummary).toHaveBeenCalledWith(
      {
        from: new Date('2026-10-01T03:00:00Z'),
        to: new Date('2026-11-01T03:00:00Z'),
      },
      new Date('2026-09-24T15:00:00Z'),
    );
    expect(ai.topOwnersByCost).toHaveBeenCalledWith(
      {
        from: new Date('2026-10-01T03:00:00Z'),
        to: new Date('2026-11-01T03:00:00Z'),
      },
      5,
    );
    expect(result.ai).toMatchObject({
      costMonthUsdCents: 1234,
      platformCostMonthUsdCents: 1500,
      costLast30DaysUsdCents: 1400,
      averageCostPerActiveAccountUsdCents: 56,
    });
    expect(result.ai.topAccounts).toHaveLength(1);
  });

  it('séries: 12 meses de MRR (snapshot do fim de setembro, mês corrente ao vivo, sem snapshot = null), novas × canceladas, planos e funil do período', async () => {
    const { service, metrics } = build();

    const { series } = await service.getOverview('30d', now);

    expect(series.mrrMonthly).toHaveLength(12);
    expect(series.mrrMonthly[0]).toEqual({ month: '2025-11', mrrCents: null });
    expect(series.mrrMonthly[10]).toEqual({
      month: '2026-09',
      mrrCents: 100000,
    });
    expect(series.mrrMonthly[11]).toEqual({
      month: '2026-10',
      mrrCents: 64766,
    });
    expect(metrics.monthlyCreated).toHaveBeenCalledWith(
      new Date('2025-11-01T03:00:00Z'),
    );
    expect(series.newVsCanceled[10]).toEqual({
      month: '2026-09',
      newAccounts: 3,
      canceledAccounts: 0,
    });
    expect(series.newVsCanceled[11]).toEqual({
      month: '2026-10',
      newAccounts: 5,
      canceledAccounts: 2,
    });
    expect(series.newVsCanceled[0]).toEqual({
      month: '2025-11',
      newAccounts: 0,
      canceledAccounts: 0,
    });
    expect(series.accountsByPlan).toHaveLength(1);
    expect(series.trialFunnel).toEqual({
      started: 5,
      withCard: 3,
      converted: 1,
    });
  });

  it('sem histórico: MRR anterior, variação, base do churn e taxas ficam null (nunca zero)', async () => {
    const { service, metrics, ai, accounts } = build();
    metrics.findSnapshotsBetween.mockResolvedValue([]);
    metrics.trialCohort.mockResolvedValue({
      started: 0,
      withCard: 0,
      converted: 0,
    });
    accounts.countClientsSeenSince.mockResolvedValue(0);
    ai.costSummary.mockResolvedValue({
      clientMonthUsdCents: 0,
      platformMonthUsdCents: 0,
      clientLast30DaysUsdCents: 0,
    });

    const result = await service.getOverview('30d', now);

    expect(result.revenue.mrrPreviousCents).toBeNull();
    expect(result.revenue.mrrChangePercent).toBeNull();
    expect(result.churn.payingAccountsAtStart).toBeNull();
    expect(result.churn.mrrAtStartCents).toBeNull();
    expect(result.churn.accountsRatePercent).toBeNull();
    expect(result.churn.revenueRatePercent).toBeNull();
    expect(result.churn.canceledAccounts).toBe(2);
    expect(result.trials.conversion90d.ratePercent).toBeNull();
    expect(result.ai.averageCostPerActiveAccountUsdCents).toBeNull();
    expect(
      result.series.mrrMonthly.slice(0, 11).every((p) => p.mrrCents === null),
    ).toBe(true);
  });

  it('12m compara com o snapshot da véspera de 12 meses atrás', async () => {
    const { service, metrics } = build();
    metrics.findSnapshotsBetween.mockResolvedValue([
      { day: '2025-10-23', mrrCents: 40000, payingAccounts: 4 },
    ]);

    const result = await service.getOverview('12m', now);

    expect(result.from).toEqual(new Date('2025-10-24T15:00:00Z'));
    expect(metrics.findSnapshotsBetween).toHaveBeenCalledWith(
      '2025-10-20',
      '2026-10-24',
    );
    expect(result.revenue.mrrPreviousCents).toBe(40000);
    expect(result.revenue.mrrChangePercent).toBe(61.9);
  });
});
