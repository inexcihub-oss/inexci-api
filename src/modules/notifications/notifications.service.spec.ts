import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { NotificationType } from 'src/database/entities/notification.entity';
import { UserRole } from 'src/database/entities/user.entity';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockNotificationRepository: {
    create: jest.Mock;
    createBulk: jest.Mock;
    findByUserId: jest.Mock;
    countUnread: jest.Mock;
    markAsRead: jest.Mock;
    markAllAsRead: jest.Mock;
    deleteByUser: jest.Mock;
  };
  let mockSettingsRepository: {
    findByUserId: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
  };
  let mockUserRepository: {
    findOne: jest.Mock;
    findByOwnerId: jest.Mock;
  };
  let mockMailService: {
    sendRaw: jest.Mock;
    sendGenericNotification: jest.Mock;
    sendStatusChangeStakeholder: jest.Mock;
  };
  let mockWhatsappService: {
    sendTemplate: jest.Mock;
  };
  let mockSurgeryRequestRepository: {
    findDistinctActivityUserIds: jest.Mock;
    findOneWithRelations: jest.Mock;
  };
  let mockGateway: { emitToUser: jest.Mock };

  const adminUser = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    ownerId: 'acc-1',
    email: 'admin@test.com',
    name: 'Admin',
  };
  const collaboratorUser = {
    id: 'collab-1',
    role: UserRole.COLLABORATOR,
    ownerId: 'acc-1',
    email: 'collab@test.com',
    name: 'Collab',
  };
  const admin2 = {
    id: 'admin-2',
    role: UserRole.ADMIN,
    ownerId: 'acc-1',
    email: 'admin2@test.com',
    name: 'Admin2',
  };

  beforeEach(async () => {
    mockNotificationRepository = {
      create: jest.fn().mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        type: NotificationType.INFO,
      }),
      createBulk: jest
        .fn()
        .mockImplementation((items) =>
          Promise.resolve(
            items.map((item, i) => ({ id: `notif-${i}`, ...item })),
          ),
        ),
      findByUserId: jest.fn().mockResolvedValue([]),
      countUnread: jest.fn().mockResolvedValue(0),
      markAsRead: jest.fn().mockResolvedValue(undefined),
      markAllAsRead: jest.fn().mockResolvedValue(undefined),
      deleteByUser: jest.fn().mockResolvedValue(undefined),
    };

    mockSettingsRepository = {
      findByUserId: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ id: 'settings-1', ...data }),
        ),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    mockUserRepository = {
      findOne: jest.fn(),
      findByOwnerId: jest.fn(),
    };

    mockMailService = {
      sendRaw: jest.fn().mockResolvedValue(undefined),
      sendGenericNotification: jest.fn().mockResolvedValue(undefined),
      sendStatusChangeStakeholder: jest.fn().mockResolvedValue(undefined),
    };
    mockWhatsappService = {
      sendTemplate: jest.fn().mockResolvedValue(undefined),
    };
    mockSurgeryRequestRepository = {
      findDistinctActivityUserIds: jest.fn().mockResolvedValue([]),
      findOneWithRelations: jest
        .fn()
        .mockResolvedValue({ patient: { name: 'Paciente Teste' } }),
    };
    mockGateway = { emitToUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: NotificationRepository,
          useValue: mockNotificationRepository,
        },
        {
          provide: UserNotificationSettingsRepository,
          useValue: mockSettingsRepository,
        },
        { provide: UserRepository, useValue: mockUserRepository },
        {
          provide: SurgeryRequestRepository,
          useValue: mockSurgeryRequestRepository,
        },
        { provide: MailService, useValue: mockMailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
        { provide: NotificationsGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── WebSocket: emitToUser ────────────────────────────────────────────────
  describe('createNotification', () => {
    it('chama gateway.emitToUser após persistir notificação', async () => {
      const notification = {
        id: 'notif-ws-1',
        userId: 'user-ws-1',
        type: NotificationType.INFO,
        title: 'Teste',
        message: 'Mensagem',
        link: null,
        metadata: null,
        createdAt: new Date(),
      };
      mockNotificationRepository.create.mockResolvedValue(notification);
      mockSettingsRepository.findByUserId.mockResolvedValue(null);

      await service.createNotification({
        userId: 'user-ws-1',
        type: NotificationType.INFO,
        title: 'Teste',
        message: 'Mensagem',
      });

      expect(mockGateway.emitToUser).toHaveBeenCalledWith('user-ws-1', {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        metadata: notification.metadata,
        createdAt: notification.createdAt,
      });
    });

    it('não cria registro in-app nem emite via WS quando pushNotifications=false', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        pushNotifications: false,
        emailNotifications: false,
        statusUpdate: true,
      });

      const result = await service.createNotification({
        userId: 'user-1',
        type: NotificationType.STATUS_UPDATE,
        title: 'Teste',
        message: 'msg',
      });

      expect(mockNotificationRepository.create).not.toHaveBeenCalled();
      expect(mockGateway.emitToUser).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('não cria notificação se o tipo está desligado nas preferências', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        pushNotifications: true,
        statusUpdate: false,
      });

      const result = await service.createNotification({
        userId: 'user-1',
        type: NotificationType.STATUS_UPDATE,
        title: 'Teste',
        message: 'msg',
      });

      expect(mockNotificationRepository.create).not.toHaveBeenCalled();
      expect(mockGateway.emitToUser).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('nunca envia e-mail (canal removido para usuários do sistema)', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        pushNotifications: true,
        statusUpdate: true,
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        name: 'User',
      });

      await service.createNotification({
        userId: 'user-1',
        type: NotificationType.STATUS_UPDATE,
        title: 'Atualização',
        message: 'msg',
      });

      expect(mockMailService.sendGenericNotification).not.toHaveBeenCalled();
    });
  });

  describe('resolveChannels', () => {
    it('retorna push e whatsapp true quando o usuário não tem registro de preferências', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue(null);
      const channels = await service.resolveChannels(
        'user-1',
        NotificationType.STATUS_UPDATE,
      );
      expect(channels).toEqual({ push: true, whatsapp: true });
    });

    it('retorna tudo false quando o tipo está desligado', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        pushNotifications: true,
        whatsappNotifications: true,
        statusUpdate: false,
      });
      const channels = await service.resolveChannels(
        'user-1',
        NotificationType.STATUS_UPDATE,
      );
      expect(channels).toEqual({ push: false, whatsapp: false });
    });

    it('respeita cada canal individualmente quando o tipo está habilitado', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        pushNotifications: false,
        whatsappNotifications: true,
        statusUpdate: true,
      });
      const channels = await service.resolveChannels(
        'user-1',
        NotificationType.STATUS_UPDATE,
      );
      expect(channels).toEqual({ push: false, whatsapp: true });
    });
  });

  describe('createNotificationForUsers', () => {
    it('chama gateway.emitToUser para cada usuário', async () => {
      const userIds = ['user-a', 'user-b'];
      mockNotificationRepository.createBulk.mockResolvedValue(
        userIds.map((uid, i) => ({
          id: `notif-${i}`,
          userId: uid,
          type: NotificationType.INFO,
          title: 'Bulk',
          message: 'msg',
          link: null,
          metadata: null,
          createdAt: new Date(),
        })),
      );
      mockSettingsRepository.findByUserId.mockResolvedValue(null);

      await service.createNotificationForUsers(userIds, {
        type: NotificationType.INFO,
        title: 'Bulk',
        message: 'msg',
      });

      expect(mockGateway.emitToUser).toHaveBeenCalledTimes(2);
      expect(mockGateway.emitToUser).toHaveBeenCalledWith(
        'user-a',
        expect.objectContaining({ id: 'notif-0', title: 'Bulk' }),
      );
      expect(mockGateway.emitToUser).toHaveBeenCalledWith(
        'user-b',
        expect.objectContaining({ id: 'notif-1', title: 'Bulk' }),
      );
    });
  });

  // ─── PRD: Notificações — 6.1 AdminNotification ───────────────────────────
  describe('notifyAdminsOfAction', () => {
    it('envia notificação para admins quando ator é colaborador (6.1.1)', async () => {
      mockUserRepository.findOne.mockResolvedValue(collaboratorUser);
      mockUserRepository.findByOwnerId.mockResolvedValue([
        adminUser,
        collaboratorUser,
      ]);

      await service.notifyAdminsOfAction(
        'collab-1',
        'Ação realizada',
        'Colaborador fez algo',
        '/link',
      );

      expect(mockNotificationRepository.createBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'admin-1',
            type: NotificationType.ACTION_BY_USER,
          }),
        ]),
      );
    });

    it('admin não recebe notificação de si mesmo (6.1.1)', async () => {
      mockUserRepository.findOne.mockResolvedValue(adminUser);
      mockUserRepository.findByOwnerId.mockResolvedValue([
        adminUser,
        collaboratorUser,
      ]);

      await service.notifyAdminsOfAction('admin-1', 'Ação', 'Admin fez algo');

      // Deve criar bulk vazio ou não chamar createBulk
      const bulkCall = mockNotificationRepository.createBulk.mock.calls[0];
      if (bulkCall) {
        expect(bulkCall[0].find((n) => n.userId === 'admin-1')).toBeUndefined();
      }
    });

    it('múltiplos admins — todos recebem (exceto o ator) (6.1.1)', async () => {
      mockUserRepository.findOne.mockResolvedValue(collaboratorUser);
      mockUserRepository.findByOwnerId.mockResolvedValue([
        adminUser,
        admin2,
        collaboratorUser,
      ]);

      await service.notifyAdminsOfAction('collab-1', 'Ação', 'Mensagem');

      const [items] = mockNotificationRepository.createBulk.mock.calls[0];
      expect(items.some((n) => n.userId === 'admin-1')).toBe(true);
      expect(items.some((n) => n.userId === 'admin-2')).toBe(true);
    });

    it('não chama createBulk se não há admins outros que o ator', async () => {
      mockUserRepository.findOne.mockResolvedValue(adminUser);
      mockUserRepository.findByOwnerId.mockResolvedValue([adminUser]); // só o admin ator

      await service.notifyAdminsOfAction('admin-1', 'Ação', 'Mensagem');

      expect(mockNotificationRepository.createBulk).not.toHaveBeenCalled();
    });

    it('não lança exceção se userRepository falhar', async () => {
      mockUserRepository.findOne.mockRejectedValue(new Error('DB down'));

      await expect(
        service.notifyAdminsOfAction('collab-1', 'Ação', 'Mensagem'),
      ).resolves.toBeUndefined();
    });
  });

  // ─── PRD: Notificações — 6.2 StatusChangeNotification ───────────────────
  describe('notifyStatusChange', () => {
    const surgeryRequestId = 'req-1';
    const doctorId = 'doctor-1';
    const createdById = 'collab-1';
    const actorId = 'collab-1';
    const oldStatus = SurgeryRequestStatus.SENT;
    const newStatus = SurgeryRequestStatus.IN_ANALYSIS;

    const doctor = {
      id: 'doctor-1',
      role: UserRole.COLLABORATOR,
      ownerId: 'acc-1',
      email: 'doctor@test.com',
      name: 'Dr. Silva',
    };

    beforeEach(() => {
      mockUserRepository.findOne.mockResolvedValue(collaboratorUser);
      mockUserRepository.findByOwnerId.mockResolvedValue([
        adminUser,
        collaboratorUser,
        doctor,
      ]);
      mockSurgeryRequestRepository.findDistinctActivityUserIds.mockResolvedValue(
        [],
      );
    });

    it('envia notificação para médico e admins quando ator é o criador (6.2.1)', async () => {
      mockSurgeryRequestRepository.findDistinctActivityUserIds.mockResolvedValue(
        [],
      );

      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      expect(mockNotificationRepository.createBulk).toHaveBeenCalled();
      const [items] = mockNotificationRepository.createBulk.mock.calls[0];
      const recipientIds = items.map((n) => n.userId);
      expect(recipientIds).toContain('doctor-1');
      expect(recipientIds).toContain('admin-1');
    });

    it('ator não recebe notificação (6.2.1)', async () => {
      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      const [items] = mockNotificationRepository.createBulk.mock.calls[0];
      const recipientIds = items.map((n) => n.userId);
      expect(recipientIds).not.toContain(actorId);
    });

    it('inclui usuários com atividade na solicitação (INC-05) (6.2.2)', async () => {
      mockSurgeryRequestRepository.findDistinctActivityUserIds.mockResolvedValue(
        ['activity-user-1'],
      );
      mockUserRepository.findByOwnerId.mockResolvedValue([
        adminUser,
        collaboratorUser,
        doctor,
        {
          id: 'activity-user-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'acc-1',
        },
      ]);

      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      const [items] = mockNotificationRepository.createBulk.mock.calls[0];
      const recipientIds = items.map((n) => n.userId);
      expect(recipientIds).toContain('activity-user-1');
    });

    it('não duplica destinatários quando doctorId === createdById (6.2.2)', async () => {
      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        doctorId,
        oldStatus,
        newStatus,
        'other-actor',
      );

      const [items] = mockNotificationRepository.createBulk.mock.calls[0];
      const recipientIds = items.map((n) => n.userId);
      const doctorOccurrences = recipientIds.filter(
        (id) => id === 'doctor-1',
      ).length;
      expect(doctorOccurrences).toBe(1);
    });

    it('notificação contém tipo STATUS_UPDATE (6.2.3)', async () => {
      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      const [items] = mockNotificationRepository.createBulk.mock.calls[0];
      expect(
        items.every((n) => n.type === NotificationType.STATUS_UPDATE),
      ).toBe(true);
    });

    it('não lança exceção se DB falhar (6.2.3)', async () => {
      mockUserRepository.findOne.mockRejectedValue(new Error('DB down'));

      await expect(
        service.notifyStatusChange(
          surgeryRequestId,
          doctorId,
          createdById,
          oldStatus,
          newStatus,
          actorId,
        ),
      ).resolves.toBeUndefined();
    });

    it('nunca envia e-mail aos stakeholders em mudança de status (6.2.4)', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        pushNotifications: true,
        whatsappNotifications: true,
        statusUpdate: true,
      });
      mockUserRepository.findOne
        .mockResolvedValueOnce(collaboratorUser)
        .mockResolvedValueOnce({
          id: 'doctor-1',
          email: 'doctor@test.com',
          name: 'Dr. Silva',
        })
        .mockResolvedValueOnce({
          id: 'admin-1',
          email: 'admin@test.com',
          name: 'Admin',
        });

      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      expect(
        mockMailService.sendStatusChangeStakeholder,
      ).not.toHaveBeenCalled();
      expect(mockMailService.sendGenericNotification).not.toHaveBeenCalled();
    });

    it('envia WhatsApp para stakeholders com whatsappNotifications habilitado e telefone', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        whatsappNotifications: true,
        statusUpdate: true,
      });
      mockUserRepository.findOne
        .mockResolvedValueOnce(collaboratorUser) // actor
        .mockResolvedValueOnce({
          id: 'doctor-1',
          email: 'doctor@test.com',
          name: 'Dr. Silva',
          phone: '11988887777',
        })
        .mockResolvedValueOnce({
          id: 'admin-1',
          email: 'admin@test.com',
          name: 'Admin',
          phone: null,
        });
      mockSurgeryRequestRepository.findOneWithRelations.mockResolvedValue({
        protocol: 'SC-000123',
        patient: { name: 'Paciente Teste' },
      });

      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      expect(mockWhatsappService.sendTemplate).toHaveBeenCalledTimes(1);
      const [phone, contentSid, vars] =
        mockWhatsappService.sendTemplate.mock.calls[0];
      expect(phone).toBe('11988887777');
      expect(contentSid).toBe('HXa61aa6d8e8aff00807496f8ce990dcd5');
      expect(vars).toMatchObject({
        '1': 'Dr. Silva',
        '2': 'SC-000123',
        '3': 'Em Análise',
        '5': 'Paciente Teste',
      });
    });

    it('não envia WhatsApp se stakeholder desativou whatsappNotifications', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        whatsappNotifications: false,
      });

      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
    });

    it('não envia WhatsApp se stakeholder não possui telefone', async () => {
      mockSettingsRepository.findByUserId.mockResolvedValue({
        whatsappNotifications: true,
        statusUpdate: true,
      });
      mockUserRepository.findOne.mockResolvedValue({
        id: 'doctor-1',
        email: 'doctor@test.com',
        name: 'Dr. Silva',
        phone: null,
      });

      await service.notifyStatusChange(
        surgeryRequestId,
        doctorId,
        createdById,
        oldStatus,
        newStatus,
        actorId,
      );

      expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
    });
  });
});
