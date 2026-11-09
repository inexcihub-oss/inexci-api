import { AppointmentStatus } from 'src/database/entities/appointment.entity';
import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { AdminAccountsRepository } from 'src/database/repositories/admin-accounts.repository';
import { AdminUsageRepository } from 'src/database/repositories/admin-usage.repository';
import { AdminAccountSituation } from '../accounts/admin-account-situation';
import { AdminUsageService } from './admin-usage.service';

const now = new Date('2026-10-23T15:00:00Z');

describe('AdminUsageService', () => {
  const usage = {
    weeklySurgeryRequestsCreated: jest.fn(),
    weeklySurgeryRequestsSent: jest.fn(),
    weeklyAppointmentsByStatus: jest.fn(),
    weeklyPatientsCreated: jest.fn(),
    weeklyRecordsFinalized: jest.fn(),
    topBySurgeryRequests: jest.fn(),
    topByAppointments: jest.fn(),
  };
  const accounts = {
    countClientsSeenSince: jest.fn(),
    countClients: jest.fn(),
    findInactiveClients: jest.fn(),
    loadMetrics: jest.fn(),
  };
  const service = new AdminUsageService(
    usage as unknown as AdminUsageRepository,
    accounts as unknown as AdminAccountsRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    usage.weeklySurgeryRequestsCreated.mockResolvedValue([]);
    usage.weeklySurgeryRequestsSent.mockResolvedValue([]);
    usage.weeklyAppointmentsByStatus.mockResolvedValue([]);
    usage.weeklyPatientsCreated.mockResolvedValue([]);
    usage.weeklyRecordsFinalized.mockResolvedValue([]);
    usage.topBySurgeryRequests.mockResolvedValue([]);
    usage.topByAppointments.mockResolvedValue([]);
    accounts.countClientsSeenSince.mockResolvedValue(0);
    accounts.countClients.mockResolvedValue(0);
  });

  describe('getUsage', () => {
    it('usa os últimos 30 dias por padrão', async () => {
      const result = await service.getUsage({}, now);

      expect(result.to).toEqual(now);
      expect(result.from).toEqual(new Date('2026-09-23T15:00:00Z'));
      expect(usage.weeklySurgeryRequestsCreated).toHaveBeenCalledWith({
        from: result.from,
        to: result.to,
      });
    });

    it('monta semanas começando na segunda em SP, com zeros nas vazias', async () => {
      const from = new Date('2026-10-05T03:00:00Z');
      const to = new Date('2026-10-20T03:00:00Z');
      usage.weeklySurgeryRequestsCreated.mockResolvedValue([
        { weekStart: '2026-10-05', count: 4 },
        { weekStart: '2026-10-19', count: 1 },
      ]);

      const result = await service.getUsage({ from, to }, now);

      expect(result.weekly.map((w) => w.weekStart)).toEqual([
        '2026-10-05',
        '2026-10-12',
        '2026-10-19',
      ]);
      expect(result.weekly.map((w) => w.surgeryRequestsCreated)).toEqual([
        4, 0, 1,
      ]);
      expect(result.totals.surgeryRequestsCreated).toBe(5);
    });

    it('um período que começa no domingo noite de SP cai na semana anterior', async () => {
      const from = new Date('2026-10-12T01:00:00Z');
      const to = new Date('2026-10-13T12:00:00Z');

      const result = await service.getUsage({ from, to }, now);

      expect(result.weekly.map((w) => w.weekStart)).toEqual([
        '2026-10-05',
        '2026-10-12',
      ]);
    });

    it('mapeia os status de consulta e soma totais e enviadas, pacientes e fichas', async () => {
      const from = new Date('2026-10-05T03:00:00Z');
      const to = new Date('2026-10-19T03:00:00Z');
      usage.weeklyAppointmentsByStatus.mockResolvedValue([
        {
          weekStart: '2026-10-05',
          status: AppointmentStatus.SCHEDULED,
          count: 2,
        },
        {
          weekStart: '2026-10-05',
          status: AppointmentStatus.CONFIRMED,
          count: 1,
        },
        {
          weekStart: '2026-10-05',
          status: AppointmentStatus.IN_PROGRESS,
          count: 1,
        },
        {
          weekStart: '2026-10-05',
          status: AppointmentStatus.COMPLETED,
          count: 5,
        },
        {
          weekStart: '2026-10-12',
          status: AppointmentStatus.COMPLETED,
          count: 3,
        },
        {
          weekStart: '2026-10-12',
          status: AppointmentStatus.CANCELLED,
          count: 2,
        },
        {
          weekStart: '2026-10-12',
          status: AppointmentStatus.NO_SHOW,
          count: 4,
        },
      ]);
      usage.weeklySurgeryRequestsSent.mockResolvedValue([
        { weekStart: '2026-10-12', count: 6 },
      ]);
      usage.weeklyPatientsCreated.mockResolvedValue([
        { weekStart: '2026-10-05', count: 7 },
      ]);
      usage.weeklyRecordsFinalized.mockResolvedValue([
        { weekStart: '2026-10-12', count: 9 },
      ]);

      const result = await service.getUsage({ from, to }, now);

      expect(result.weekly[0].appointments).toEqual({
        scheduled: 4,
        completed: 5,
        cancelled: 0,
        noShow: 0,
      });
      expect(result.totals).toEqual({
        surgeryRequestsCreated: 0,
        surgeryRequestsSent: 6,
        appointments: { scheduled: 4, completed: 8, cancelled: 2, noShow: 4 },
        patientsCreated: 7,
        recordsFinalized: 9,
      });
    });

    it('conta contas ativas em 7 e 30 dias e devolve os rankings', async () => {
      accounts.countClientsSeenSince
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(8);
      accounts.countClients.mockResolvedValue(12);
      const top = [{ ownerId: 'o-1', name: 'A', email: 'a@x.com', count: 9 }];
      usage.topBySurgeryRequests.mockResolvedValue(top);

      const result = await service.getUsage({}, now);

      expect(accounts.countClientsSeenSince).toHaveBeenNthCalledWith(
        1,
        new Date('2026-10-16T15:00:00Z'),
      );
      expect(accounts.countClientsSeenSince).toHaveBeenNthCalledWith(
        2,
        new Date('2026-09-23T15:00:00Z'),
      );
      expect(result.activeAccounts).toEqual({
        last7Days: 3,
        last30Days: 8,
        totalClients: 12,
      });
      expect(result.topBySurgeryRequests).toBe(top);
      expect(usage.topBySurgeryRequests).toHaveBeenCalledWith(
        { from: result.from, to: result.to },
        10,
      );
    });
  });

  describe('getInactive', () => {
    function sub(ownerId: string, status: SubscriptionStatus): Subscription {
      return {
        id: `sub-${ownerId}`,
        ownerId,
        status,
        trialEndsAt: null,
        pastDueSince: null,
        cancelAtPeriodEnd: false,
        plan: {
          id: 'plan-1',
          name: 'Profissional',
          priceCents: 29900,
          billingPeriod: 'MONTHLY',
        },
      } as unknown as Subscription;
    }

    it('devolve situação, plano e dias sem acesso, sem dado de paciente', async () => {
      accounts.findInactiveClients.mockResolvedValue({
        total: 2,
        items: [
          {
            subscription: sub('o-1', SubscriptionStatus.ACTIVE),
            ownerName: 'Dra. A',
            ownerEmail: 'a@x.com',
            ownerCreatedAt: new Date(),
          },
          {
            subscription: sub('o-2', SubscriptionStatus.SUSPENDED),
            ownerName: 'Dr. B',
            ownerEmail: 'b@x.com',
            ownerCreatedAt: new Date(),
          },
        ],
      });
      accounts.loadMetrics.mockResolvedValue({
        lastSeen: new Map([['o-1', new Date('2026-10-10T15:00:00Z')]]),
      });

      const result = await service.getInactive(7, now);

      expect(accounts.findInactiveClients).toHaveBeenCalledWith(7, now, 200);
      expect(result.days).toBe(7);
      expect(result.total).toBe(2);
      expect(result.items[0]).toEqual({
        ownerId: 'o-1',
        name: 'Dra. A',
        email: 'a@x.com',
        plan: {
          id: 'plan-1',
          name: 'Profissional',
          priceCents: 29900,
          billingPeriod: 'MONTHLY',
        },
        situation: AdminAccountSituation.ACTIVE,
        daysLeft: null,
        daysOverdue: null,
        lastSeenAt: new Date('2026-10-10T15:00:00Z'),
        daysSinceLastSeen: 13,
      });
      expect(result.items[1].situation).toBe(AdminAccountSituation.SUSPENDED);
      expect(result.items[1].lastSeenAt).toBeNull();
      expect(result.items[1].daysSinceLastSeen).toBeNull();
    });
  });
});
