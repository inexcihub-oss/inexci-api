import { Test, TestingModule } from '@nestjs/testing';
import {
  StaleNotificationService,
  STALE_TIERS,
} from './stale-notification.service';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { StaleNotificationLogRepository } from 'src/database/repositories/stale-notification-log.repository';
import { NotificationsService } from './notifications.service';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { UserRole } from 'src/database/entities/user.entity';

// Mock WHATSAPP_TEMPLATES before importing the service
jest.mock('src/shared/whatsapp/whatsapp-templates.constants', () => ({
  WHATSAPP_TEMPLATES: {
    STATUS_CHANGE_PATIENT: 'mock-status-sid',
    STALE_STATUS_MESSAGE: 'mock-stale-sid',
    WELCOME_PATIENT: 'mock-welcome-patient-sid',
    WELCOME_USER: 'mock-welcome-user-sid',
  },
}));

describe('StaleNotificationService', () => {
  let service: StaleNotificationService;

  const mockSurgeryRequestRepository = {
    findStaleRequests: jest.fn(),
    findDistinctActivityUserIds: jest.fn().mockResolvedValue([]),
  };

  const mockStaleLogRepository = {
    hasBeenNotified: jest.fn(),
    record: jest.fn().mockResolvedValue({}),
    deleteByRequest: jest.fn(),
  };

  const mockNotificationsService = {
    createNotificationForUsers: jest.fn().mockResolvedValue([]),
    resolveChannels: jest.fn().mockResolvedValue({
      push: true,
      whatsapp: true,
    }),
  };

  const mockMailService = {
    sendRaw: jest.fn().mockResolvedValue(undefined),
    sendStaleReminder: jest.fn().mockResolvedValue(undefined),
    sendStaleCritical: jest.fn().mockResolvedValue(undefined),
  };

  const mockWhatsappService = {
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    findByOwnerId: jest.fn(),
  };

  const makeStaleRequest = (
    daysAgo: number,
    status = SurgeryRequestStatus.IN_ANALYSIS,
  ) => {
    const lastChanged = new Date();
    lastChanged.setDate(lastChanged.getDate() - daysAgo);
    return {
      id: `req-${daysAgo}`,
      protocol: `SC-${String(daysAgo).padStart(6, '0')}`,
      doctorId: 'doctor-1',
      createdById: 'creator-1',
      status,
      lastStatusChangedAt: lastChanged,
      patient: { name: 'Paciente Teste' },
      createdBy: { id: 'creator-1', ownerId: 'acc-1' },
    };
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockUserRepository.findByOwnerId.mockResolvedValue([
      {
        id: 'admin-1',
        role: UserRole.ADMIN,
        ownerId: 'acc-1',
        email: 'admin@test.com',
        name: 'Admin',
        phone: '+5511999999999',
      },
      {
        id: 'creator-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'acc-1',
        email: 'creator@test.com',
        name: 'Creator',
      },
    ]);
    mockUserRepository.findOne.mockImplementation(({ id }) => {
      const users = {
        'admin-1': {
          id: 'admin-1',
          email: 'admin@test.com',
          name: 'Admin',
          phone: '+5511999999999',
        },
        'creator-1': {
          id: 'creator-1',
          email: 'creator@test.com',
          name: 'Creator',
          phone: null,
        },
        'doctor-1': {
          id: 'doctor-1',
          email: 'doctor@test.com',
          name: 'Doctor',
          phone: '+5511888888888',
        },
      };
      return Promise.resolve(users[id] ?? null);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaleNotificationService,
        {
          provide: SurgeryRequestRepository,
          useValue: mockSurgeryRequestRepository,
        },
        {
          provide: StaleNotificationLogRepository,
          useValue: mockStaleLogRepository,
        },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: MailService, useValue: mockMailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
        { provide: UserRepository, useValue: mockUserRepository },
      ],
    }).compile();

    service = module.get<StaleNotificationService>(StaleNotificationService);
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('getMatchingTier', () => {
    it('retorna tier de 3 dias para solicitação parada há 3 dias', () => {
      const tier = service.getMatchingTier(3);
      expect(tier?.days).toBe(3);
      expect(tier?.severity).toBe('reminder');
    });

    it('retorna tier de 7 dias para solicitação parada há 7 dias', () => {
      const tier = service.getMatchingTier(7);
      expect(tier?.days).toBe(7);
      expect(tier?.severity).toBe('attention');
    });

    it('retorna tier de 15 dias para solicitação parada há 15 dias', () => {
      const tier = service.getMatchingTier(15);
      expect(tier?.days).toBe(15);
      expect(tier?.severity).toBe('alert');
      expect(tier?.notifyWhatsApp).toBe(true);
    });

    it('retorna tier de 30 dias (crítico) para solicitação parada há 30+ dias', () => {
      const tier = service.getMatchingTier(35);
      expect(tier?.days).toBe(30);
      expect(tier?.severity).toBe('critical');
      expect(tier?.notifyWhatsApp).toBe(true);
      expect(tier?.notifyAll).toBe(true);
    });

    it('retorna null para solicitação parada há menos de 3 dias', () => {
      expect(service.getMatchingTier(2)).toBeNull();
      expect(service.getMatchingTier(0)).toBeNull();
    });
  });

  describe('checkAndNotifyStaleRequests', () => {
    it('solicitação parada há 3 dias → notificação leve (6.3.1)', async () => {
      const request = makeStaleRequest(3);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);

      const count = await service.checkAndNotifyStaleRequests();

      expect(count).toBe(1);
      expect(
        mockNotificationsService.createNotificationForUsers,
      ).toHaveBeenCalled();
      expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
    });

    it('solicitação parada há 7 dias → notificação de atenção (6.3.1)', async () => {
      const request = makeStaleRequest(7);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);

      const count = await service.checkAndNotifyStaleRequests();

      expect(count).toBe(1);
      expect(
        mockNotificationsService.createNotificationForUsers,
      ).toHaveBeenCalled();
    });

    it('solicitação parada há 15 dias → alerta com WhatsApp para admin (6.3.1)', async () => {
      const request = makeStaleRequest(15);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);

      await service.checkAndNotifyStaleRequests();

      expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
    });

    it('solicitação parada há 30 dias → crítico para todos (6.3.1)', async () => {
      const request = makeStaleRequest(30);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);
      mockSurgeryRequestRepository.findDistinctActivityUserIds.mockResolvedValue(
        ['activity-user-1'],
      );

      await service.checkAndNotifyStaleRequests();

      expect(
        mockNotificationsService.createNotificationForUsers,
      ).toHaveBeenCalled();
      expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
    });

    it('solicitação já notificada em 3 dias não é re-notificada — idempotência (6.3.1)', async () => {
      const request = makeStaleRequest(3);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(true);

      const count = await service.checkAndNotifyStaleRequests();

      expect(count).toBe(0);
      expect(
        mockNotificationsService.createNotificationForUsers,
      ).not.toHaveBeenCalled();
    });

    it('registra no stale_notification_log após notificação (6.3.2)', async () => {
      const request = makeStaleRequest(7);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);

      await service.checkAndNotifyStaleRequests();

      expect(mockStaleLogRepository.record).toHaveBeenCalledWith(
        request.id,
        7,
        'in_app',
      );
    });

    it('não lança exceção se uma solicitação falhar (6.3.3)', async () => {
      const request = makeStaleRequest(3);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockRejectedValue(
        new Error('DB down'),
      );

      await expect(service.checkAndNotifyStaleRequests()).resolves.toBe(0);
    });

    it('retorna 0 se não há solicitações paradas', async () => {
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([]);

      const count = await service.checkAndNotifyStaleRequests();

      expect(count).toBe(0);
    });

    it('nunca envia e-mail stale (canal removido para usuários do sistema)', async () => {
      const request = makeStaleRequest(7);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);

      await service.checkAndNotifyStaleRequests();

      expect(mockMailService.sendStaleReminder).not.toHaveBeenCalled();
      expect(mockMailService.sendStaleCritical).not.toHaveBeenCalled();
    });

    it('nunca envia e-mail mesmo em tier crítico (30 dias)', async () => {
      const request = makeStaleRequest(30);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);
      mockNotificationsService.resolveChannels.mockResolvedValue({
        push: true,
        whatsapp: true,
      });

      await service.checkAndNotifyStaleRequests();

      expect(mockMailService.sendStaleReminder).not.toHaveBeenCalled();
      expect(mockMailService.sendStaleCritical).not.toHaveBeenCalled();
    });

    it('não envia WhatsApp stale se destinatário desativou whatsappNotifications', async () => {
      const request = makeStaleRequest(15);
      mockSurgeryRequestRepository.findStaleRequests.mockResolvedValue([
        request,
      ]);
      mockStaleLogRepository.hasBeenNotified.mockResolvedValue(false);
      mockNotificationsService.resolveChannels.mockResolvedValue({
        push: true,
        whatsapp: false,
      });

      await service.checkAndNotifyStaleRequests();

      expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
    });
  });
});
