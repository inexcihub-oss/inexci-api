import { MENSAGEM_DESATIVAR_COM_ASSINATURA } from '../subscriptions/subscription-admin-rules';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import {
  AdminAccountsMetrics,
  AdminAccountsRepository,
} from 'src/database/repositories/admin-accounts.repository';
import { PaymentGateway } from 'src/shared/payment-gateway';
import { Permission } from 'src/shared/permissions';
import { AdminAccountSituation } from './admin-account-situation';
import { AdminAccountsService } from './admin-accounts.service';
import { AccountHealthService } from '../health/account-health.service';
import {
  AdminTeamMemberStatus,
  AdminTeamRole,
} from './dto/admin-account-response.dto';
import { AdminActivationRepository } from 'src/database/repositories/admin-activation.repository';
import { AdminAccountSort } from './dto/list-admin-accounts-query.dto';

const now = new Date('2026-10-23T15:00:00Z');

function subscription(
  ownerId: string,
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: `sub-${ownerId}`,
    ownerId,
    planId: 'plan-1',
    status: SubscriptionStatus.ACTIVE,
    trialEndsAt: null,
    currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
    pastDueSince: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    suspendedAt: null,
    gatewayProvider: 'stripe',
    gatewayCustomerId: 'cus_1',
    gatewaySubscriptionId: 'sub_1',
    plan: {
      id: 'plan-1',
      name: 'Profissional',
      priceCents: 29900,
      billingPeriod: 'MONTHLY',
      surgeryRequestQuota: 50,
    },
    ...overrides,
  } as unknown as Subscription;
}

function row(
  sub: Subscription,
  name = 'Dr. A',
  deactivation: { at: Date | null; byId: string | null } = {
    at: null,
    byId: null,
  },
) {
  return {
    subscription: sub,
    ownerName: name,
    ownerEmail: `${sub.ownerId}@x.com`,
    ownerCreatedAt: new Date('2026-01-01T00:00:00Z'),
    ownerDeactivatedAt: deactivation.at,
    ownerDeactivatedById: deactivation.byId,
  };
}

function emptyMetrics(): AdminAccountsMetrics {
  return {
    team: new Map(),
    surgeryRequests: new Map(),
    appointmentsMonth: new Map(),
    aiCostMonthCents: new Map(),
    lastSeen: new Map(),
    quota: new Map(),
  };
}

describe('AdminAccountsService', () => {
  const repo = {
    findPage: jest.fn(),
    countBySituation: jest.fn(),
    loadMetrics: jest.fn(),
    findByOwnerId: jest.fn(),
    findTeam: jest.fn(),
    surgeryRequestsByStatus: jest.fn(),
    appointmentsByStatus: jest.fn(),
    patientCounts: jest.fn(),
    finalizedRecordsCount: jest.fn(),
    aiMessagesCount: jest.fn(),
    weeklySurgeryRequests: jest.fn(),
    weeklyAppointments: jest.fn(),
    findPlatformAdminName: jest.fn(),
  };
  const gateway = {
    providerId: 'stripe',
    getSubscriptionWithDiscount: jest.fn(),
    getCustomerPaymentSummary: jest.fn(),
    getLatestSubscriptionByCustomer: jest.fn(),
  };
  const config = { get: jest.fn() };
  const health = {
    ensureFresh: jest.fn(),
    latestFor: jest.fn(),
    computeOne: jest.fn(),
    history: jest.fn(),
  };
  const activation = { findMemberUsage: jest.fn() };
  let service: AdminAccountsService;

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockReturnValue('sk_test_abc');
    gateway.providerId = 'stripe';
    health.ensureFresh.mockResolvedValue(undefined);
    health.latestFor.mockResolvedValue(new Map());
    health.computeOne.mockResolvedValue(null);
    health.history.mockResolvedValue([]);
    service = new AdminAccountsService(
      repo as unknown as AdminAccountsRepository,
      config as unknown as ConfigService,
      gateway as unknown as PaymentGateway,
      health as unknown as AccountHealthService,
      activation as unknown as AdminActivationRepository,
    );
  });

  describe('list', () => {
    it('monta o item com situação, plano, equipe e uso', async () => {
      const sub = subscription('o-1');
      const metrics = emptyMetrics();
      metrics.team.set('o-1', { doctors: 2, collaborators: 3 });
      metrics.surgeryRequests.set('o-1', { total: 40, month: 7 });
      metrics.appointmentsMonth.set('o-1', 12);
      metrics.aiCostMonthCents.set('o-1', 85);
      metrics.lastSeen.set('o-1', new Date('2026-10-22T10:00:00Z'));
      metrics.quota.set('o-1', { used: 7, limit: 50 });
      repo.findPage.mockResolvedValue({ items: [row(sub)], total: 1 });
      repo.countBySituation.mockResolvedValue([
        { situation: 'active', count: 1 },
      ]);
      repo.loadMetrics.mockResolvedValue(metrics);

      const result = await service.list({}, now);

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        ownerId: 'o-1',
        name: 'Dr. A',
        situation: AdminAccountSituation.ACTIVE,
        monthlyAmountCents: 29900,
        hasGatewaySubscription: true,
        doctors: 2,
        collaborators: 3,
        surgeryRequestsThisMonth: 7,
        surgeryRequestsTotal: 40,
        quota: { used: 7, limit: 50 },
        appointmentsThisMonth: 12,
        aiCostThisMonthUsdCents: 85,
        lastSeenAt: new Date('2026-10-22T10:00:00Z'),
        plan: {
          id: 'plan-1',
          name: 'Profissional',
          priceCents: 29900,
          billingPeriod: 'MONTHLY',
        },
      });
    });

    it('usa limites padrão e repassa filtros ao repositório', async () => {
      repo.findPage.mockResolvedValue({ items: [], total: 0 });
      repo.countBySituation.mockResolvedValue([]);
      repo.loadMetrics.mockResolvedValue(emptyMetrics());

      await service.list(
        { search: 'ana', planId: 'p', inactiveDays: 7, trialEndingInDays: 3 },
        now,
      );

      expect(repo.findPage).toHaveBeenCalledWith({
        search: 'ana',
        situation: undefined,
        planId: 'p',
        trialEndingInDays: 3,
        inactiveDays: 7,
        health: undefined,
        sortBy: 'createdAt',
        sortDir: 'DESC',
        limit: 25,
        offset: 0,
        now,
      });
      expect(repo.countBySituation).toHaveBeenCalledWith({
        search: 'ana',
        planId: 'p',
        now,
      });
    });

    it('atualiza a saúde se estiver velha, filtra pela faixa e mostra a nota do último cálculo com o principal motivo', async () => {
      repo.findPage.mockResolvedValue({
        items: [row(subscription('o-1')), row(subscription('o-2'))],
        total: 2,
      });
      repo.countBySituation.mockResolvedValue([]);
      repo.loadMetrics.mockResolvedValue(emptyMetrics());
      health.latestFor.mockResolvedValue(
        new Map([
          [
            'o-1',
            {
              score: 30,
              band: 'risk',
              factors: [
                {
                  key: 'last_seen',
                  points: 35,
                  message: 'Ninguém da clínica acessa há 31 dias',
                },
                { key: 'errors', points: 35, message: 'erros' },
              ],
            },
          ],
        ]),
      );

      const result = await service.list(
        { health: 'risk', sortBy: AdminAccountSort.HEALTH },
        now,
      );

      expect(health.ensureFresh).toHaveBeenCalledWith(now);
      expect(health.ensureFresh.mock.invocationCallOrder[0]).toBeLessThan(
        repo.findPage.mock.invocationCallOrder[0],
      );
      expect(repo.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ health: 'risk', sortBy: 'health' }),
      );
      expect(health.latestFor).toHaveBeenCalledWith(['o-1', 'o-2']);
      expect(result.items[0].health).toEqual({
        score: 30,
        band: 'risk',
        mainReason: 'Ninguém da clínica acessa há 31 dias',
      });
      expect(result.items[1].health).toBeNull();
    });

    it('busca as métricas uma vez para a página inteira', async () => {
      repo.findPage.mockResolvedValue({
        items: [row(subscription('o-1')), row(subscription('o-2'))],
        total: 2,
      });
      repo.countBySituation.mockResolvedValue([]);
      repo.loadMetrics.mockResolvedValue(emptyMetrics());

      await service.list({}, now);

      expect(repo.loadMetrics).toHaveBeenCalledTimes(1);
      expect(repo.loadMetrics.mock.calls[0][0]).toEqual(['o-1', 'o-2']);
      expect(repo.loadMetrics.mock.calls[0][1]).toEqual(['sub-o-1', 'sub-o-2']);
    });

    it('agregados de uma conta não vazam para outra', async () => {
      const metrics = emptyMetrics();
      metrics.team.set('o-1', { doctors: 5, collaborators: 9 });
      metrics.surgeryRequests.set('o-1', { total: 100, month: 30 });
      metrics.appointmentsMonth.set('o-1', 44);
      metrics.aiCostMonthCents.set('o-1', 999);
      metrics.lastSeen.set('o-1', new Date('2026-10-22T10:00:00Z'));
      metrics.quota.set('o-1', { used: 30, limit: 100 });
      metrics.team.set('o-2', { doctors: 1, collaborators: 0 });
      repo.findPage.mockResolvedValue({
        items: [row(subscription('o-1')), row(subscription('o-2'), 'Dr. B')],
        total: 2,
      });
      repo.countBySituation.mockResolvedValue([]);
      repo.loadMetrics.mockResolvedValue(metrics);

      const { items } = await service.list({}, now);

      expect(items[1]).toMatchObject({
        ownerId: 'o-2',
        doctors: 1,
        collaborators: 0,
        surgeryRequestsThisMonth: 0,
        surgeryRequestsTotal: 0,
        appointmentsThisMonth: 0,
        aiCostThisMonthUsdCents: 0,
        lastSeenAt: null,
        quota: { used: 0, limit: 50 },
      });
    });

    it('calcula a situação de trial vencido e cancelamento agendado', async () => {
      repo.findPage.mockResolvedValue({
        items: [
          row(
            subscription('o-1', {
              status: SubscriptionStatus.TRIALING,
              trialEndsAt: new Date('2026-10-20T15:00:00Z'),
              gatewaySubscriptionId: null,
            }),
          ),
          row(subscription('o-2', { cancelAtPeriodEnd: true })),
        ],
        total: 2,
      });
      repo.countBySituation.mockResolvedValue([]);
      repo.loadMetrics.mockResolvedValue(emptyMetrics());

      const { items } = await service.list({}, now);

      expect(items[0]).toMatchObject({
        situation: AdminAccountSituation.TRIAL_EXPIRED,
        daysOverdue: 3,
        monthlyAmountCents: 0,
        hasGatewaySubscription: false,
      });
      expect(items[1].situation).toBe(AdminAccountSituation.CANCEL_SCHEDULED);
    });

    it('soma os contadores por situação e o total geral', async () => {
      repo.findPage.mockResolvedValue({ items: [], total: 0 });
      repo.countBySituation.mockResolvedValue([
        { situation: 'trial', count: 4 },
        { situation: 'active', count: 10 },
        { situation: 'internal', count: 1 },
      ]);
      repo.loadMetrics.mockResolvedValue(emptyMetrics());

      const { counts } = await service.list({}, now);

      expect(counts).toEqual({
        all: 15,
        trial: 4,
        trial_expired: 0,
        active: 10,
        cancel_scheduled: 0,
        past_due: 0,
        suspended: 0,
        canceled: 0,
        internal: 1,
        deactivated: 0,
      });
    });
  });

  describe('getDetail', () => {
    function arrangeUsage() {
      repo.findByOwnerId.mockResolvedValue(row(subscription('o-1')));
      repo.loadMetrics.mockResolvedValue(emptyMetrics());
      repo.surgeryRequestsByStatus.mockResolvedValue([
        { status: 2, total: 5, period: 2 },
      ]);
      repo.appointmentsByStatus.mockResolvedValue([
        { status: AppointmentStatus.SCHEDULED, count: 3 },
        { status: AppointmentStatus.CONFIRMED, count: 2 },
        { status: AppointmentStatus.COMPLETED, count: 7 },
        { status: AppointmentStatus.CANCELLED, count: 1 },
        { status: AppointmentStatus.NO_SHOW, count: 4 },
      ]);
      repo.patientCounts.mockResolvedValue({ total: 50, created: 6 });
      repo.finalizedRecordsCount.mockResolvedValue(9);
      repo.aiMessagesCount.mockResolvedValue(33);
      repo.weeklySurgeryRequests.mockResolvedValue([
        { weekStart: '2026-10-19', count: 4 },
      ]);
      repo.weeklyAppointments.mockResolvedValue([
        { weekStart: '2026-10-12', count: 8 },
      ]);
    }

    it('calcula a saúde ao vivo e traz o histórico de 30 dias', async () => {
      arrangeUsage();
      health.computeOne.mockResolvedValue({
        score: 62,
        band: 'attention',
        factors: [
          {
            key: 'usage_drop',
            points: 20,
            message: 'Uso caiu 80% em relação à semana anterior',
          },
          { key: 'errors', points: 18, message: 'erros' },
        ],
      });
      health.history.mockResolvedValue([
        { day: '2026-10-27', score: 70, band: 'healthy' },
      ]);

      const detail = await service.getDetail('o-1', {}, now);

      expect(health.computeOne).toHaveBeenCalledWith('o-1', now);
      expect(detail.health).toEqual({
        score: 62,
        band: 'attention',
        mainReason: 'Uso caiu 80% em relação à semana anterior',
      });
      expect(detail.healthDetail).toEqual({
        score: 62,
        band: 'attention',
        mainReason: 'Uso caiu 80% em relação à semana anterior',
        factors: [
          {
            key: 'usage_drop',
            points: 20,
            message: 'Uso caiu 80% em relação à semana anterior',
          },
          { key: 'errors', points: 18, message: 'erros' },
        ],
        computedAt: now,
      });
      expect(detail.healthHistory).toEqual([
        { day: '2026-10-27', score: 70, band: 'healthy' },
      ]);
    });

    it('conta fora da avaliação fica sem nota', async () => {
      arrangeUsage();
      const detail = await service.getDetail('o-1', {}, now);
      expect(detail.health).toBeNull();
      expect(detail.healthDetail).toBeNull();
    });

    it('devolve o uso do mês corrente em São Paulo por padrão', async () => {
      arrangeUsage();

      const detail = await service.getDetail('o-1', {}, now);

      expect(detail.usage.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
      expect(detail.usage.to.toISOString()).toBe('2026-11-01T03:00:00.000Z');
      expect(detail.usage.appointments).toEqual({
        scheduled: 5,
        completed: 7,
        cancelled: 1,
        noShow: 4,
      });
      expect(detail.usage.patients).toEqual({ total: 50, newInPeriod: 6 });
      expect(detail.usage.finalizedRecordsInPeriod).toBe(9);
      expect(detail.usage.aiMessagesInPeriod).toBe(33);
    });

    it('lista todos os status de SC, com zero nos ausentes', async () => {
      arrangeUsage();

      const { usage } = await service.getDetail('o-1', {}, now);

      expect(usage.surgeryRequestsByStatus).toHaveLength(9);
      expect(usage.surgeryRequestsByStatus[1]).toEqual({
        status: 2,
        total: 5,
        inPeriod: 2,
      });
      expect(usage.surgeryRequestsByStatus[0]).toEqual({
        status: 1,
        total: 0,
        inPeriod: 0,
      });
    });

    it('atividade traz 12 semanas contínuas, preenchendo as vazias', async () => {
      arrangeUsage();

      const { usage } = await service.getDetail('o-1', {}, now);

      expect(usage.activity).toHaveLength(12);
      expect(usage.activity[11]).toEqual({
        weekStart: '2026-10-19',
        surgeryRequests: 4,
        appointments: 0,
      });
      expect(usage.activity[10]).toEqual({
        weekStart: '2026-10-12',
        surgeryRequests: 0,
        appointments: 8,
      });
      expect(usage.activity[0].weekStart).toBe('2026-08-03');
      expect(repo.weeklySurgeryRequests.mock.calls[0][1].toISOString()).toBe(
        '2026-08-03T03:00:00.000Z',
      );
    });

    it('respeita from e to informados', async () => {
      arrangeUsage();
      const from = new Date('2026-09-01T03:00:00Z');
      const to = new Date('2026-10-01T03:00:00Z');

      const { usage } = await service.getDetail('o-1', { from, to }, now);

      expect(usage.from).toBe(from);
      expect(repo.patientCounts).toHaveBeenCalledWith('o-1', { from, to });
    });

    it('conta desativada pelo painel aparece como Desativada, com data e autor', async () => {
      arrangeUsage();
      const at = new Date('2026-10-20T12:00:00Z');
      repo.findByOwnerId.mockResolvedValue(
        row(subscription('o-1'), 'Dr. A', { at, byId: 'adm-1' }),
      );
      repo.findPlatformAdminName.mockResolvedValue('Ana Admin');

      const detail = await service.getDetail('o-1', {}, now);

      expect(detail.situation).toBe(AdminAccountSituation.DEACTIVATED);
      expect(detail.daysLeft).toBeNull();
      expect(detail.accountDeactivatedAt).toBe(at);
      expect(detail.accountDeactivatedByName).toBe('Ana Admin');
      expect(repo.findPlatformAdminName).toHaveBeenCalledWith('adm-1');
    });

    it('conta ativa não busca autor de desativação', async () => {
      arrangeUsage();

      const detail = await service.getDetail('o-1', {}, now);

      expect(detail.accountDeactivatedAt).toBeNull();
      expect(detail.accountDeactivatedByName).toBeNull();
      expect(repo.findPlatformAdminName).not.toHaveBeenCalled();
    });

    it('conta inexistente ou sem assinatura vira 404', async () => {
      repo.findByOwnerId.mockResolvedValue(null);

      await expect(service.getDetail('x', {}, now)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getTeam', () => {
    it('classifica dono, médico e colaborador sem expor dados sensíveis', async () => {
      repo.findByOwnerId.mockResolvedValue(row(subscription('o-1')));
      const base = { ownerId: 'o-1', permissions: [], lastSeenAt: null };
      repo.findTeam.mockResolvedValue([
        {
          ...base,
          id: 'o-1',
          name: 'Dono',
          email: 'dono@x.com',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          doctorProfile: { id: 'dp-0', council: 'CRM' },
        },
        {
          ...base,
          id: 'u-2',
          name: 'Médico',
          email: 'med@x.com',
          role: UserRole.COLLABORATOR,
          status: UserStatus.ACTIVE,
          doctorProfile: { id: 'dp-1', council: 'CRM' },
        },
        {
          ...base,
          id: 'u-3',
          name: 'Secretária',
          email: 'sec@x.com',
          role: UserRole.COLLABORATOR,
          status: UserStatus.INACTIVE,
          permissions: [Permission.AGENDA],
          lastSeenAt: new Date('2026-10-20T10:00:00Z'),
          doctorProfile: null,
          phone: '11999999999',
          cpf: '12345678901',
          mfaEnabledAt: new Date('2026-10-02T10:00:00Z'),
          mfaSecret: 'segredo-totp',
          privacyPolicyAcceptedAt: new Date('2026-10-01T10:00:00Z'),
          termsOfUseAcceptedAt: new Date('2026-10-01T10:00:00Z'),
          aiConsentAcceptedAt: null,
          onboardingState: {
            status: 'in_progress',
            completedSteps: {
              'marcar-consulta': '2026-10-03T10:00:00Z',
              inventado: '2026-10-03T10:00:00Z',
            },
            toursSeen: {},
          },
        },
      ] as unknown);

      activation.findMemberUsage.mockResolvedValue([
        {
          userId: 'u-3',
          surgeryRequests: 2,
          appointments: 5,
          recordsFinalized: 0,
          assistantMessages: 4,
          aiCostUsdCents: 37,
        },
      ]);
      const now = new Date('2026-10-28T12:00:00Z');

      const team = await service.getTeam('o-1', 7, now);

      expect(activation.findMemberUsage).toHaveBeenCalledWith('o-1', {
        from: new Date('2026-10-21T12:00:00Z'),
        to: now,
      });
      expect(team.days).toBe(7);
      expect(team.items.map((m) => m.role)).toEqual([
        AdminTeamRole.OWNER,
        AdminTeamRole.DOCTOR,
        AdminTeamRole.COLLABORATOR,
      ]);
      expect(team.items[0].permissions).toEqual(
        expect.arrayContaining([Permission.ADMINISTRACAO]),
      );
      expect(team.items[1].permissions).toEqual(
        expect.arrayContaining([Permission.ATENDIMENTO, Permission.AGENDA]),
      );
      expect(team.items[1].isDoctor).toBe(true);
      expect(team.items[0].usage).toEqual({
        surgeryRequests: 0,
        appointments: 0,
        recordsFinalized: 0,
        assistantMessages: 0,
        aiCostUsdCents: 0,
      });
      expect(team.items[2]).toEqual({
        id: 'u-3',
        name: 'Secretária',
        email: 'sec@x.com',
        role: AdminTeamRole.COLLABORATOR,
        isDoctor: false,
        permissions: [Permission.AGENDA],
        active: false,
        status: AdminTeamMemberStatus.INACTIVE,
        lastSeenAt: new Date('2026-10-20T10:00:00Z'),
        mfaEnabled: true,
        privacyPolicyAcceptedAt: new Date('2026-10-01T10:00:00Z'),
        termsOfUseAcceptedAt: new Date('2026-10-01T10:00:00Z'),
        aiConsentAcceptedAt: null,
        whatsappPhoneMasked: '*******9999',
        onboarding: {
          status: 'in_progress',
          completedSteps: 1,
          totalSteps: 12,
          toursSeen: 0,
          totalTours: 9,
        },
        usage: {
          surgeryRequests: 2,
          appointments: 5,
          recordsFinalized: 0,
          assistantMessages: 4,
          aiCostUsdCents: 37,
        },
      });
      expect(JSON.stringify(team)).not.toContain('11999999999');
      expect(JSON.stringify(team)).not.toContain('12345678901');
      expect(JSON.stringify(team)).not.toContain('segredo-totp');
    });

    it('conta inexistente vira 404', async () => {
      repo.findByOwnerId.mockResolvedValue(null);

      await expect(service.getTeam('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findTeam).not.toHaveBeenCalled();
    });
  });

  describe('getSubscription', () => {
    it('une banco e leitura ao vivo da Stripe', async () => {
      repo.findByOwnerId.mockResolvedValue(row(subscription('o-1')));
      gateway.getSubscriptionWithDiscount.mockResolvedValue({
        status: 'active',
        trialEndsAt: null,
        currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
        cancelAtPeriodEnd: true,
        discount: {
          name: 'Parceiro',
          percentOff: 20,
          amountOffCents: null,
          duration: 'forever',
        },
      });
      gateway.getCustomerPaymentSummary.mockResolvedValue({
        hasPaymentMethod: true,
        brand: 'visa',
        last4: '4242',
      });

      const result = await service.getSubscription('o-1', now);

      expect(gateway.getSubscriptionWithDiscount).toHaveBeenCalledWith('sub_1');
      expect(gateway.getCustomerPaymentSummary).toHaveBeenCalledWith('cus_1');
      expect(result.gatewayError).toBe(false);
      expect(result.gateway).toEqual({
        status: 'active',
        trialEndsAt: null,
        currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
        cancelAtPeriodEnd: true,
        discount: {
          name: 'Parceiro',
          percentOff: 20,
          amountOffCents: null,
          duration: 'forever',
        },
        hasPaymentMethod: true,
        paymentBrand: 'visa',
        paymentLast4: '4242',
      });
      expect(result.stripeCustomerUrl).toBe(
        'https://dashboard.stripe.com/test/customers/cus_1',
      );
      expect(result.situation).toBe(AdminAccountSituation.ACTIVE);
      expect(result.status).toBe('active');
    });

    it('chave live gera link sem /test', async () => {
      config.get.mockReturnValue('sk_live_abc');
      repo.findByOwnerId.mockResolvedValue(row(subscription('o-1')));
      gateway.getSubscriptionWithDiscount.mockResolvedValue(null);
      gateway.getCustomerPaymentSummary.mockResolvedValue({
        hasPaymentMethod: false,
        brand: null,
        last4: null,
      });

      const result = await service.getSubscription('o-1', now);

      expect(result.stripeCustomerUrl).toBe(
        'https://dashboard.stripe.com/customers/cus_1',
      );
    });

    it('falha da Stripe devolve o banco com gatewayError e sem 500', async () => {
      repo.findByOwnerId.mockResolvedValue(row(subscription('o-1')));
      gateway.getSubscriptionWithDiscount.mockRejectedValue(
        new Error('timeout'),
      );
      gateway.getCustomerPaymentSummary.mockResolvedValue({
        hasPaymentMethod: false,
        brand: null,
        last4: null,
      });

      const result = await service.getSubscription('o-1', now);

      expect(result.gatewayError).toBe(true);
      expect(result.gateway).toBeNull();
      expect(result.plan.name).toBe('Profissional');
      expect(result.currentPeriodEnd).toEqual(new Date('2026-11-01T00:00:00Z'));
    });

    it('trial local sem cadastro na Stripe não consulta o gateway', async () => {
      repo.findByOwnerId.mockResolvedValue(
        row(
          subscription('o-1', {
            status: SubscriptionStatus.TRIALING,
            trialEndsAt: new Date('2026-10-30T15:00:00Z'),
            gatewayCustomerId: null,
            gatewaySubscriptionId: null,
          }),
        ),
      );

      const result = await service.getSubscription('o-1', now);

      expect(gateway.getSubscriptionWithDiscount).not.toHaveBeenCalled();
      expect(gateway.getCustomerPaymentSummary).not.toHaveBeenCalled();
      expect(result.gateway).toBeNull();
      expect(result.gatewayError).toBe(false);
      expect(result.stripeCustomerUrl).toBeNull();
      expect(result.daysLeft).toBe(7);
    });

    it('assinatura de outro provedor não é lida', async () => {
      repo.findByOwnerId.mockResolvedValue(
        row(subscription('o-1', { gatewayProvider: 'asaas' })),
      );

      const result = await service.getSubscription('o-1', now);

      expect(gateway.getSubscriptionWithDiscount).not.toHaveBeenCalled();
      expect(result.gateway).toBeNull();
    });

    it('conta inexistente vira 404', async () => {
      repo.findByOwnerId.mockResolvedValue(null);

      await expect(service.getSubscription('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    describe('ações disponíveis (mesma regra das ações)', () => {
      const noCard = {
        hasPaymentMethod: false,
        brand: null,
        last4: null,
      };

      it('trial local sem Stripe pode receber acesso interno e ter o trial estendido', async () => {
        repo.findByOwnerId.mockResolvedValue(
          row(
            subscription('o-1', {
              status: SubscriptionStatus.TRIALING,
              trialEndsAt: new Date('2026-10-30T15:00:00Z'),
              gatewayCustomerId: null,
              gatewaySubscriptionId: null,
            }),
          ),
        );

        const result = await service.getSubscription('o-1', now);

        expect(result.canGrantInternalAccess).toBe(true);
        expect(result.internalAccessBlockedReason).toBeNull();
        expect(result.canExtendTrial).toBe(true);
        expect(result.trialExtensionBlockedReason).toBeNull();
        expect(result.canDeactivate).toBe(true);
        expect(result.deactivationBlockedReason).toBeNull();
        expect(result.internalAccessGrantedAt).toBeNull();
        expect(result.internalAccessGrantedByName).toBeNull();
      });

      it('assinatura viva na Stripe bloqueia o acesso interno com o motivo', async () => {
        repo.findByOwnerId.mockResolvedValue(row(subscription('o-1')));
        gateway.getSubscriptionWithDiscount.mockResolvedValue({
          id: 'sub_1',
          status: 'active',
          providerStatus: 'active',
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        });
        gateway.getCustomerPaymentSummary.mockResolvedValue(noCard);

        const result = await service.getSubscription('o-1', now);

        expect(gateway.getLatestSubscriptionByCustomer).toHaveBeenCalledWith(
          'cus_1',
        );
        expect(result.canGrantInternalAccess).toBe(false);
        expect(result.internalAccessBlockedReason).toBe(
          'Conta com assinatura na Stripe não pode receber acesso interno.',
        );
        expect(result.canExtendTrial).toBe(false);
        expect(result.trialExtensionBlockedReason).toEqual(expect.any(String));
        expect(result.canDeactivate).toBe(false);
        expect(result.deactivationBlockedReason).toBe(
          MENSAGEM_DESATIVAR_COM_ASSINATURA,
        );
      });

      it('assinatura viva achada só pelo cliente também bloqueia; trialing lá permite estender', async () => {
        repo.findByOwnerId.mockResolvedValue(row(subscription('o-1')));
        gateway.getSubscriptionWithDiscount.mockResolvedValue({
          id: 'sub_1',
          status: 'canceled',
          providerStatus: 'canceled',
        });
        gateway.getLatestSubscriptionByCustomer.mockResolvedValue({
          id: 'sub_2',
          status: 'active',
          providerStatus: 'trialing',
        });
        gateway.getCustomerPaymentSummary.mockResolvedValue(noCard);

        const result = await service.getSubscription('o-1', now);

        expect(result.canGrantInternalAccess).toBe(false);
        expect(result.canExtendTrial).toBe(true);
      });

      it('trial com cartão (ACTIVE com trial vigente) aparece como Trial, sem MRR e pode ser estendido', async () => {
        repo.findByOwnerId.mockResolvedValue(
          row(
            subscription('o-1', {
              status: SubscriptionStatus.ACTIVE,
              trialEndsAt: new Date('2026-10-30T15:00:00Z'),
            }),
          ),
        );
        gateway.getSubscriptionWithDiscount.mockResolvedValue({
          id: 'sub_1',
          status: 'active',
          providerStatus: 'trialing',
        });
        gateway.getLatestSubscriptionByCustomer.mockResolvedValue(null);
        gateway.getCustomerPaymentSummary.mockResolvedValue(noCard);

        const result = await service.getSubscription('o-1', now);

        expect(result.situation).toBe(AdminAccountSituation.TRIAL);
        expect(result.daysLeft).toBe(7);
        expect(result.monthlyAmountCents).toBe(0);
        expect(result.canExtendTrial).toBe(true);
        expect(result.canGrantInternalAccess).toBe(false);
      });

      it('só assinatura cancelada na Stripe permite o acesso interno', async () => {
        repo.findByOwnerId.mockResolvedValue(
          row(subscription('o-1', { status: SubscriptionStatus.CANCELED })),
        );
        gateway.getSubscriptionWithDiscount.mockResolvedValue({
          id: 'sub_1',
          status: 'canceled',
          providerStatus: 'canceled',
        });
        gateway.getLatestSubscriptionByCustomer.mockResolvedValue(null);
        gateway.getCustomerPaymentSummary.mockResolvedValue(noCard);

        const result = await service.getSubscription('o-1', now);

        expect(result.canGrantInternalAccess).toBe(true);
        expect(result.canExtendTrial).toBe(false);
      });

      it('Stripe fora do ar bloqueia as duas (fail-closed)', async () => {
        repo.findByOwnerId.mockResolvedValue(
          row(subscription('o-1', { status: SubscriptionStatus.TRIALING })),
        );
        gateway.getSubscriptionWithDiscount.mockRejectedValue(
          new Error('timeout'),
        );
        gateway.getCustomerPaymentSummary.mockResolvedValue(noCard);

        const result = await service.getSubscription('o-1', now);

        expect(result.gatewayError).toBe(true);
        expect(result.canGrantInternalAccess).toBe(false);
        expect(result.internalAccessBlockedReason).toContain('Stripe');
        expect(result.canExtendTrial).toBe(false);
      });

      it('assinatura de outro provedor com cadastro bloqueia (não dá para confirmar)', async () => {
        repo.findByOwnerId.mockResolvedValue(
          row(subscription('o-1', { gatewayProvider: 'asaas' })),
        );

        const result = await service.getSubscription('o-1', now);

        expect(result.canGrantInternalAccess).toBe(false);
      });

      it('acesso interno mostra quem liberou e quando, sem consultar a Stripe para a regra', async () => {
        repo.findByOwnerId.mockResolvedValue(
          row(
            subscription('o-1', {
              status: SubscriptionStatus.INTERNAL,
              gatewayCustomerId: null,
              gatewaySubscriptionId: null,
              internalAccessGrantedBy: 'admin-1',
              internalAccessGrantedAt: new Date('2026-10-20T12:00:00Z'),
            }),
          ),
        );
        repo.findPlatformAdminName.mockResolvedValue('Ana Admin');

        const result = await service.getSubscription('o-1', now);

        expect(result.situation).toBe(AdminAccountSituation.INTERNAL);
        expect(result.canGrantInternalAccess).toBe(false);
        expect(result.internalAccessBlockedReason).toBe(
          'A conta já tem acesso interno.',
        );
        expect(result.canExtendTrial).toBe(false);
        expect(result.internalAccessGrantedAt).toEqual(
          new Date('2026-10-20T12:00:00Z'),
        );
        expect(result.internalAccessGrantedByName).toBe('Ana Admin');
        expect(repo.findPlatformAdminName).toHaveBeenCalledWith('admin-1');
      });
    });
  });
});
