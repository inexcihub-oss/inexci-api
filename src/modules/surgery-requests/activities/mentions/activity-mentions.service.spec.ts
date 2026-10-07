import { Test, TestingModule } from '@nestjs/testing';
import { ActivityMentionsService } from './activity-mentions.service';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { NotificationDispatcherService } from 'src/modules/notifications/notification-dispatcher.service';
import { NotificationType } from 'src/database/entities/notification.entity';
import { MentionEmailsJobsService } from './mention-emails-jobs.service';

describe('ActivityMentionsService', () => {
  let service: ActivityMentionsService;
  let mentionRepository: {
    createMany: jest.Mock;
    setNotificationId: jest.Mock;
  };
  let accessControl: { getUsersWithAccessToDoctor: jest.Mock };
  let dispatcher: { dispatch: jest.Mock };
  let mentionEmailsJobs: { schedule: jest.Mock };

  const params = {
    activityId: 'act-1',
    surgeryRequestId: 'sc-1',
    doctorUserId: 'doc-1',
    ownerId: 'owner-1',
    authorId: 'autor-1',
    authorName: 'Dra. Ana',
    content: 'confere o laudo, por favor',
    mentionedUserIds: ['user-2'],
  };

  beforeEach(async () => {
    mentionRepository = {
      createMany: jest
        .fn()
        .mockImplementation((activityId: string, ids: string[]) =>
          Promise.resolve(
            ids.map((mentionedUserId, i) => ({
              id: `mention-${i + 1}`,
              activityId,
              mentionedUserId,
            })),
          ),
        ),
      setNotificationId: jest.fn().mockResolvedValue(undefined),
    };
    accessControl = {
      getUsersWithAccessToDoctor: jest.fn().mockResolvedValue([
        { id: 'user-2', name: 'Dr. Bruno' },
        { id: 'autor-1', name: 'Dra. Ana' },
      ]),
    };
    dispatcher = {
      dispatch: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };
    mentionEmailsJobs = { schedule: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityMentionsService,
        {
          provide: SurgeryRequestActivityMentionRepository,
          useValue: mentionRepository,
        },
        { provide: AccessControlService, useValue: accessControl },
        { provide: NotificationDispatcherService, useValue: dispatcher },
        { provide: MentionEmailsJobsService, useValue: mentionEmailsJobs },
      ],
    }).compile();

    service = module.get(ActivityMentionsService);
  });

  it('grava a menção e devolve o usuário mencionado', async () => {
    const result = await service.register(params);

    expect(mentionRepository.createMany).toHaveBeenCalledWith('act-1', [
      'user-2',
    ]);
    expect(result).toEqual([{ id: 'user-2', name: 'Dr. Bruno' }]);
  });

  it('notifica o mencionado com link para a aba de atividades', async () => {
    await service.register(params);

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        type: NotificationType.MENTION,
        title: 'Dra. Ana mencionou você',
        link: '/solicitacao/sc-1?sidebar=atividades',
        metadata: expect.objectContaining({
          category: 'mention',
          activityId: 'act-1',
          surgeryRequestId: 'sc-1',
          actorId: 'autor-1',
        }),
      }),
    );
  });

  it('liga a menção à notificação criada, para o e-mail saber se foi lida', async () => {
    await service.register(params);

    expect(mentionRepository.setNotificationId).toHaveBeenCalledWith(
      'mention-1',
      'notif-1',
    );
  });

  it('descarta quem não tem acesso à solicitação', async () => {
    const result = await service.register({
      ...params,
      mentionedUserIds: ['intruso-1'],
    });

    expect(result).toEqual([]);
    expect(mentionRepository.createMany).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('descarta a menção ao próprio autor', async () => {
    const result = await service.register({
      ...params,
      mentionedUserIds: ['autor-1'],
    });

    expect(result).toEqual([]);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('ignora ids repetidos no mesmo comentário', async () => {
    await service.register({
      ...params,
      mentionedUserIds: ['user-2', 'user-2'],
    });

    expect(mentionRepository.createMany).toHaveBeenCalledWith('act-1', [
      'user-2',
    ]);
  });

  it('não vai ao banco quando não há menção', async () => {
    const result = await service.register({
      ...params,
      mentionedUserIds: [],
    });

    expect(result).toEqual([]);
    expect(accessControl.getUsersWithAccessToDoctor).not.toHaveBeenCalled();
  });

  it('nunca propaga erro: o comentário já foi salvo', async () => {
    dispatcher.dispatch.mockRejectedValue(new Error('redis fora do ar'));

    await expect(service.register(params)).resolves.toEqual([
      { id: 'user-2', name: 'Dr. Bruno' },
    ]);
  });

  it('trunca a mensagem longa da notificação', async () => {
    await service.register({ ...params, content: 'a'.repeat(200) });

    const [[dto]] = dispatcher.dispatch.mock.calls;
    expect(dto.message.length).toBeLessThanOrEqual(143);
    // A prévia vai entre aspas: "texto truncado…"
    expect(dto.message.endsWith('…"')).toBe(true);
  });
  it('agenda o e-mail atrasado da menção', async () => {
    await service.register(params);

    expect(mentionEmailsJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionId: 'mention-1',
        surgeryRequestId: 'sc-1',
        authorName: 'Dra. Ana',
        content: 'confere o laudo, por favor',
        inAppNotified: true,
      }),
    );
  });

  it('marca o job sem notificação in-app quando o push está desligado', async () => {
    dispatcher.dispatch.mockResolvedValue(null);

    await service.register(params);

    expect(mentionEmailsJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ inAppNotified: false }),
    );
  });
});
