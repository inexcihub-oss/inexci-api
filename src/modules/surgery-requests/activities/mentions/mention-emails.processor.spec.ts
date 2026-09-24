import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bull';
import { MentionEmailsProcessor } from './mention-emails.processor';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ConfigService } from '@nestjs/config';
import { MentionEmailJobData } from './mention-emails-jobs.service';

describe('MentionEmailsProcessor', () => {
  let processor: MentionEmailsProcessor;
  let mentionRepository: {
    findOneWithUser: jest.Mock;
    claimEmailSend: jest.Mock;
    releaseEmailSend: jest.Mock;
  };
  let notificationRepository: { findOne: jest.Mock };
  let settingsRepository: { findByUserId: jest.Mock };
  let mailService: { sendGenericNotification: jest.Mock };
  let surgeryRequestRepository: { findOneMinimal: jest.Mock };

  const job = {
    data: {
      mentionId: 'mention-1',
      surgeryRequestId: 'sc-1',
      authorName: 'Dra. Ana',
      content: 'confere o laudo',
      inAppNotified: true,
    } as MentionEmailJobData,
  } as Job<MentionEmailJobData>;

  beforeEach(async () => {
    mentionRepository = {
      findOneWithUser: jest.fn().mockResolvedValue({
        id: 'mention-1',
        mentionedUserId: 'user-2',
        notificationId: 'notif-1',
        emailSentAt: null,
        mentionedUser: {
          id: 'user-2',
          name: 'Dr. Bruno',
          email: 'bruno@example.com',
        },
      }),
      claimEmailSend: jest.fn().mockResolvedValue(true),
      releaseEmailSend: jest.fn().mockResolvedValue(undefined),
    };
    notificationRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'notif-1', read: false }),
    };
    settingsRepository = {
      findByUserId: jest.fn().mockResolvedValue({ mentionEmails: true }),
    };
    surgeryRequestRepository = {
      findOneMinimal: jest.fn().mockResolvedValue({
        id: 'sc-1',
        protocol: 'SC-000123',
        patient: { name: 'João Silva' },
        procedure: { name: 'Artroscopia de Joelho' },
      }),
    };
    mailService = { sendGenericNotification: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionEmailsProcessor,
        {
          provide: SurgeryRequestActivityMentionRepository,
          useValue: mentionRepository,
        },
        { provide: NotificationRepository, useValue: notificationRepository },
        {
          provide: UserNotificationSettingsRepository,
          useValue: settingsRepository,
        },
        {
          provide: SurgeryRequestRepository,
          useValue: surgeryRequestRepository,
        },
        { provide: MailService, useValue: mailService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'https://app.inexci.com.br') },
        },
      ],
    }).compile();

    processor = module.get(MentionEmailsProcessor);
  });

  it('envia o e-mail quando a notificação continua não lida', async () => {
    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).toHaveBeenCalledWith(
      'bruno@example.com',
      'Dra. Ana mencionou você em uma solicitação',
      expect.objectContaining({
        userName: 'Dr. Bruno',
        link: 'https://app.inexci.com.br/solicitacao/sc-1?sidebar=atividades',
        linkText: 'Abrir solicitação',
      }),
    );
    expect(mentionRepository.claimEmailSend).toHaveBeenCalledWith('mention-1');
  });

  it('diz de qual solicitação a menção veio', async () => {
    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        context: 'Solicitação SC-000123 · João Silva · Artroscopia de Joelho',
      }),
    );
  });

  it('não põe nome de paciente no assunto', async () => {
    await processor.handleSend(job);

    const [, assunto] = mailService.sendGenericNotification.mock.calls[0];
    // O assunto vaza para prévia de notificação e lista da caixa de entrada;
    // nenhum e-mail da plataforma identifica paciente ali.
    expect(assunto).not.toContain('João Silva');
  });

  it('usa o que houver quando a SC não tem protocolo nem procedimento', async () => {
    surgeryRequestRepository.findOneMinimal.mockResolvedValue({
      id: 'sc-1',
      protocol: null,
      patient: { name: 'João Silva' },
      procedure: null,
    });

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ context: 'Solicitação · João Silva' }),
    );
  });

  it('envia mesmo se a leitura da SC falhar', async () => {
    surgeryRequestRepository.findOneMinimal.mockRejectedValue(
      new Error('banco fora'),
    );

    await processor.handleSend(job);

    // O e-mail é o último aviso de uma menção não lida: identificar a SC é
    // ganho de contexto, não pré-requisito.
    expect(mailService.sendGenericNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ context: undefined }),
    );
    expect(mentionRepository.claimEmailSend).toHaveBeenCalledWith('mention-1');
  });

  it('não envia quando a notificação já foi lida', async () => {
    notificationRepository.findOne.mockResolvedValue({
      id: 'notif-1',
      read: true,
    });

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
    expect(mentionRepository.claimEmailSend).not.toHaveBeenCalled();
  });

  it('não envia duas vezes', async () => {
    mentionRepository.findOneWithUser.mockResolvedValue({
      id: 'mention-1',
      mentionedUserId: 'user-2',
      notificationId: 'notif-1',
      emailSentAt: new Date(),
      mentionedUser: { email: 'bruno@example.com', name: 'Dr. Bruno' },
    });

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
  });

  it('respeita o toggle do usuário', async () => {
    settingsRepository.findByUserId.mockResolvedValue({
      mentionEmails: false,
    });

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
  });

  it('envia quando o push está desligado e não existe notificação para ler', async () => {
    mentionRepository.findOneWithUser.mockResolvedValue({
      id: 'mention-1',
      mentionedUserId: 'user-2',
      notificationId: null,
      emailSentAt: null,
      mentionedUser: { email: 'bruno@example.com', name: 'Dr. Bruno' },
    });

    await processor.handleSend({
      data: { ...job.data, inAppNotified: false },
    } as Job<MentionEmailJobData>);

    expect(mailService.sendGenericNotification).toHaveBeenCalled();
    expect(notificationRepository.findOne).not.toHaveBeenCalled();
  });

  it('não envia quando o usuário excluiu a notificação (FK virou nula)', async () => {
    mentionRepository.findOneWithUser.mockResolvedValue({
      id: 'mention-1',
      mentionedUserId: 'user-2',
      notificationId: null,
      emailSentAt: null,
      mentionedUser: { email: 'bruno@example.com', name: 'Dr. Bruno' },
    });

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
  });

  it('não envia quando a notificação sumiu entre as consultas', async () => {
    notificationRepository.findOne.mockResolvedValue(null);

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
  });

  it('job antigo, sem inAppNotified, mantém o envio sem notificação', async () => {
    mentionRepository.findOneWithUser.mockResolvedValue({
      id: 'mention-1',
      mentionedUserId: 'user-2',
      notificationId: null,
      emailSentAt: null,
      mentionedUser: { email: 'bruno@example.com', name: 'Dr. Bruno' },
    });
    const { inAppNotified: _, ...legado } = job.data;

    await processor.handleSend({ data: legado } as Job<MentionEmailJobData>);

    expect(mailService.sendGenericNotification).toHaveBeenCalled();
  });

  it('não envia quando outra tentativa do job já reservou o envio', async () => {
    mentionRepository.claimEmailSend.mockResolvedValue(false);

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
  });

  it('reserva o envio antes de ir para a fila de e-mail', async () => {
    await processor.handleSend(job);

    expect(
      mentionRepository.claimEmailSend.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mailService.sendGenericNotification.mock.invocationCallOrder[0],
    );
  });

  it('desfaz a reserva quando o envio falha, para o retry tentar de novo', async () => {
    mailService.sendGenericNotification.mockRejectedValue(new Error('smtp'));

    await expect(processor.handleSend(job)).rejects.toThrow('smtp');
    expect(mentionRepository.releaseEmailSend).toHaveBeenCalledWith(
      'mention-1',
    );
  });

  it('sai quieto quando a menção foi apagada junto com a atividade', async () => {
    mentionRepository.findOneWithUser.mockResolvedValue(null);

    await expect(processor.handleSend(job)).resolves.toBeUndefined();
    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
  });

  it('sai quieto quando o usuário não tem e-mail', async () => {
    mentionRepository.findOneWithUser.mockResolvedValue({
      id: 'mention-1',
      mentionedUserId: 'user-2',
      notificationId: null,
      emailSentAt: null,
      mentionedUser: { email: null, name: 'Dr. Bruno' },
    });

    await processor.handleSend(job);

    expect(mailService.sendGenericNotification).not.toHaveBeenCalled();
  });
});
