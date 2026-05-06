import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { NotificationType } from 'src/database/entities/notification.entity';

describe('NotificationDispatcherService', () => {
  let service: NotificationDispatcherService;

  const mockNotificationRepository = {
    create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
  };
  const mockSettingsRepository = {
    findByUserId: jest.fn(),
  };
  const mockUserRepository = {
    findOne: jest.fn(),
  };
  const mockMailService = {
    sendRaw: jest.fn().mockResolvedValue(undefined),
    sendGenericNotification: jest.fn().mockResolvedValue(undefined),
  };
  const mockWhatsappService = {
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockSettingsRepository.findByUserId.mockResolvedValue({
      email_notifications: true,
      whatsapp_notifications: true,
      push_notifications: true,
      status_update: true,
      new_surgery_request: true,
      pendencies: true,
      expiring_documents: true,
    });

    mockUserRepository.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'user@test.com',
      name: 'User',
      phone: '+5511999999999',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatcherService,
        {
          provide: NotificationRepository,
          useValue: mockNotificationRepository,
        },
        {
          provide: UserNotificationSettingsRepository,
          useValue: mockSettingsRepository,
        },
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: MailService, useValue: mockMailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
      ],
    }).compile();

    service = module.get<NotificationDispatcherService>(
      NotificationDispatcherService,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  it('cria notificação in-app, envia e-mail e WhatsApp quando tudo habilitado (6.6.1)', async () => {
    await service.dispatch({
      userId: 'user-1',
      type: NotificationType.STATUS_UPDATE,
      title: 'Status Atualizado',
      message: 'Mensagem',
      link: '/link',
      whatsappContentSid: 'mock-sid',
      whatsappVariables: { '1': 'valor' },
    });

    expect(mockNotificationRepository.create).toHaveBeenCalled();
    expect(mockMailService.sendGenericNotification).toHaveBeenCalled();
    expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
  });

  it('respeita opt-out de e-mail (6.6.1)', async () => {
    mockSettingsRepository.findByUserId.mockResolvedValue({
      email_notifications: false,
      whatsapp_notifications: true,
      push_notifications: true,
      status_update: true,
    });

    await service.dispatch({
      userId: 'user-1',
      type: NotificationType.STATUS_UPDATE,
      title: 'Status',
      message: 'Msg',
    });

    expect(mockNotificationRepository.create).toHaveBeenCalled();
    expect(mockMailService.sendGenericNotification).not.toHaveBeenCalled();
  });

  it('respeita opt-out de WhatsApp (inclui whatsapp_notifications) (6.6.1)', async () => {
    mockSettingsRepository.findByUserId.mockResolvedValue({
      email_notifications: true,
      whatsapp_notifications: false,
      push_notifications: true,
      status_update: true,
    });

    await service.dispatch({
      userId: 'user-1',
      type: NotificationType.STATUS_UPDATE,
      title: 'Status',
      message: 'Msg',
      whatsappContentSid: 'mock-sid',
      whatsappVariables: { '1': 'valor' },
    });

    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('falha em e-mail não bloqueia WhatsApp (6.6.1)', async () => {
    mockMailService.sendGenericNotification.mockRejectedValueOnce(
      new Error('SMTP down'),
    );

    await service.dispatch({
      userId: 'user-1',
      type: NotificationType.STATUS_UPDATE,
      title: 'Status',
      message: 'Msg',
      whatsappContentSid: 'mock-sid',
      whatsappVariables: { '1': 'valor' },
    });

    expect(mockWhatsappService.sendTemplate).toHaveBeenCalled();
  });

  it('falha em in-app não bloqueia e-mail (6.6.1)', async () => {
    mockNotificationRepository.create.mockRejectedValueOnce(
      new Error('DB down'),
    );

    await service.dispatch({
      userId: 'user-1',
      type: NotificationType.STATUS_UPDATE,
      title: 'Status',
      message: 'Msg',
    });

    expect(mockMailService.sendGenericNotification).toHaveBeenCalled();
  });

  it('não envia WhatsApp se whatsappContentSid não fornecido', async () => {
    await service.dispatch({
      userId: 'user-1',
      type: NotificationType.STATUS_UPDATE,
      title: 'Status',
      message: 'Msg',
    });

    expect(mockWhatsappService.sendTemplate).not.toHaveBeenCalled();
  });

  it('dispatchToMany envia para todos os usuários', async () => {
    await service.dispatchToMany(['user-1', 'user-2', 'user-3'], {
      type: NotificationType.INFO,
      title: 'Aviso',
      message: 'Mensagem',
    });

    expect(mockNotificationRepository.create).toHaveBeenCalledTimes(3);
  });
});
