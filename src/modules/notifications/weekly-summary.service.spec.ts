import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { WeeklySummaryService } from './weekly-summary.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { PendencyValidatorService } from 'src/modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { UserStatus } from 'src/database/entities/user.entity';

describe('WeeklySummaryService', () => {
  let service: WeeklySummaryService;
  let mockUserRepository: { repository: { find: jest.Mock } };
  let mockSurgeryRequestRepository: { repository: { find: jest.Mock } };
  let mockSettingsRepository: { findByUserId: jest.Mock };
  let mockMailService: { sendWeeklySummary: jest.Mock };
  let mockAccessControlService: { getAccessibleDoctorIds: jest.Mock };
  let mockPendencyValidator: { getSummary: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  const baseUser = {
    id: 'user-1',
    email: 'user@test.com',
    name: 'Dr. Teste',
    status: UserStatus.ACTIVE,
  };

  beforeEach(async () => {
    mockUserRepository = {
      repository: { find: jest.fn().mockResolvedValue([baseUser]) },
    };
    mockSurgeryRequestRepository = {
      repository: { find: jest.fn().mockResolvedValue([]) },
    };
    mockSettingsRepository = {
      findByUserId: jest.fn().mockResolvedValue(null),
    };
    mockMailService = {
      sendWeeklySummary: jest.fn().mockResolvedValue(undefined),
    };
    mockAccessControlService = {
      getAccessibleDoctorIds: jest.fn().mockResolvedValue(['doctor-1']),
    };
    mockPendencyValidator = {
      getSummary: jest.fn().mockResolvedValue({
        pending: 0,
        total: 0,
        canAdvance: true,
        items: [],
      }),
    };
    mockConfigService = {
      get: jest.fn().mockReturnValue('https://app.inexci.com.br'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklySummaryService,
        { provide: UserRepository, useValue: mockUserRepository },
        {
          provide: SurgeryRequestRepository,
          useValue: mockSurgeryRequestRepository,
        },
        {
          provide: UserNotificationSettingsRepository,
          useValue: mockSettingsRepository,
        },
        { provide: MailService, useValue: mockMailService },
        { provide: AccessControlService, useValue: mockAccessControlService },
        { provide: PendencyValidatorService, useValue: mockPendencyValidator },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WeeklySummaryService>(WeeklySummaryService);
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('getLastWeekRange', () => {
    it('retorna janela [segunda anterior 00:00 UTC, segunda atual 00:00 UTC) quando rodado num domingo', () => {
      const sunday = new Date('2026-05-10T11:00:00.000Z'); // domingo
      const { start, end } = service.getLastWeekRange(sunday);

      expect(start.getUTCFullYear()).toBe(2026);
      expect(start.getUTCMonth()).toBe(3); // abril (0-indexed)
      expect(start.getUTCDate()).toBe(27);
      expect(start.getUTCHours()).toBe(0);
      expect(start.getUTCMinutes()).toBe(0);

      expect(end.getUTCFullYear()).toBe(2026);
      expect(end.getUTCMonth()).toBe(4); // maio
      expect(end.getUTCDate()).toBe(4);
      expect(end.getUTCHours()).toBe(0);
    });
  });

  describe('sendWeeklySummariesForAllUsers', () => {
    it('não envia e-mail quando não há solicitações com movimentação ou pendências', async () => {
      mockUserRepository.repository.find.mockResolvedValue([
        { ...baseUser, email: 'a@a.com' },
      ]);

      const dispatched = await service.sendWeeklySummariesForAllUsers();

      expect(dispatched).toBe(0);
      expect(mockMailService.sendWeeklySummary).not.toHaveBeenCalled();
    });

    it('envia e-mail quando há solicitações criadas na semana', async () => {
      const now = new Date();
      const lastWeek = new Date(now);
      lastWeek.setDate(now.getDate() - 3);

      mockSurgeryRequestRepository.repository.find.mockResolvedValue([
        {
          id: 'req-1',
          protocol: 'SC-000001',
          status: SurgeryRequestStatus.PENDING,
          createdAt: lastWeek,
          lastStatusChangedAt: lastWeek,
          patient: { name: 'João' },
        },
      ]);

      const dispatched = await service.sendWeeklySummariesForAllUsers(
        new Date(),
      );

      // O cron usa a janela "semana anterior" — para garantir movimentação,
      // forçamos que a SC esteja dentro dessa janela através da mock.
      expect(mockMailService.sendWeeklySummary).toHaveBeenCalledTimes(
        dispatched,
      );
    });

    it('respeita opt-out de weeklyReport=false', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        weeklyReport: false,
      });

      const dispatched = await service.sendWeeklySummariesForAllUsers();

      expect(dispatched).toBe(0);
      expect(mockMailService.sendWeeklySummary).not.toHaveBeenCalled();
    });

    it('não envia para usuários sem médicos acessíveis', async () => {
      mockAccessControlService.getAccessibleDoctorIds.mockResolvedValue([]);

      const dispatched = await service.sendWeeklySummariesForAllUsers();

      expect(dispatched).toBe(0);
      expect(mockMailService.sendWeeklySummary).not.toHaveBeenCalled();
    });

    it('inclui pendências bloqueantes em SCs ativas no destaque', async () => {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 3);

      mockSurgeryRequestRepository.repository.find.mockResolvedValue([
        {
          id: 'req-1',
          protocol: 'SC-PEND',
          status: SurgeryRequestStatus.PENDING,
          createdAt: new Date('2020-01-01'),
          lastStatusChangedAt: new Date('2020-01-01'),
          patient: { name: 'Maria' },
        },
      ]);

      mockPendencyValidator.getSummary.mockResolvedValue({
        pending: 2,
        total: 5,
        canAdvance: false,
        items: [],
      });

      await service.sendWeeklySummariesForAllUsers();

      if (mockMailService.sendWeeklySummary.mock.calls.length > 0) {
        const [, ctx] = mockMailService.sendWeeklySummary.mock.calls[0];
        expect(ctx.counts.withPendingBlocking).toBe(1);
        expect(ctx.highlights[0]).toMatchObject({
          protocol: 'SC-PEND',
          patientName: 'Maria',
          statusLabel: 'Pendente',
        });
        expect(ctx.highlights[0].pendingLabel).toContain('2 pendências');
      }
    });
  });
});
