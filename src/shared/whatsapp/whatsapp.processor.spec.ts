import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { WhatsappProcessor } from './whatsapp.processor';
import {
  NotificationSendLog,
  NotificationSendStatus,
  NotificationChannel,
  NotificationDirection,
  NotificationSendType,
} from 'src/database/entities/notification-send-log.entity';

describe('WhatsappProcessor', () => {
  let processor: WhatsappProcessor;
  let mockSendLogRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;

    mockSendLogRepository = {
      create: jest.fn().mockImplementation((data) => ({ ...data })),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappProcessor,
        {
          provide: getRepositoryToken(NotificationSendLog),
          useValue: mockSendLogRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'TWILIO_ACCOUNT_SID') return undefined;
              if (key === 'TWILIO_AUTH_TOKEN') return undefined;
              if (key === 'TWILIO_WHATSAPP_FROM') return '+5511999999999';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    processor = module.get<WhatsappProcessor>(WhatsappProcessor);
  });

  it('deve estar definido', () => {
    expect(processor).toBeDefined();
  });

  describe('handleSendWhatsapp', () => {
    const createJob = (to: string, body: string) =>
      ({ data: { to, body }, id: '1', attemptsMade: 0 }) as any;
    const createTemplateJob = (
      to: string,
      contentSid: string,
      variables: Record<string, string>,
    ) =>
      ({
        data: { to, contentSid, variables },
        id: '2',
        attemptsMade: 0,
      }) as any;

    it('deve criar log unificado a cada envio (US-002)', async () => {
      const job = createJob('+5511999999999', 'Olá teste');
      await processor.handleSendWhatsapp(job);

      expect(mockSendLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: NotificationChannel.WHATSAPP,
          to: '+5511999999999',
          body: 'Olá teste',
          direction: NotificationDirection.OUTBOUND,
          notificationType: NotificationSendType.FREEFORM,
        }),
      );
      expect(mockSendLogRepository.save).toHaveBeenCalled();
    });

    it('deve marcar status como SENT quando sucesso no modo dev', async () => {
      const job = createJob('+5511999999999', 'Mensagem teste');
      await processor.handleSendWhatsapp(job);

      const savedLog = mockSendLogRepository.save.mock.calls[0][0];
      expect(savedLog.status).toBe(NotificationSendStatus.SENT);
      expect(savedLog.sent_at).toBeInstanceOf(Date);
    });

    it('deve salvar log no finally mesmo sem Twilio configurado', async () => {
      const job = createJob('+5511988887777', 'Teste');
      await processor.handleSendWhatsapp(job);

      expect(mockSendLogRepository.save).toHaveBeenCalledTimes(1);
    });

    it('deve tratar erro de save sem propagar exceção', async () => {
      mockSendLogRepository.save.mockRejectedValue(new Error('DB error'));
      const job = createJob('+5511999999999', 'Teste');

      await expect(processor.handleSendWhatsapp(job)).resolves.toBeUndefined();
    });

    it('deve logar template job no modo dev sem exceção', async () => {
      const job = createTemplateJob('+5511999999999', 'HXabc123', {
        '1': 'João',
        '2': 'Em Análise',
      });

      await expect(processor.handleSendWhatsapp(job)).resolves.toBeUndefined();
    });

    it('deve salvar log com body descrevendo o template', async () => {
      const job = createTemplateJob('+5511988887777', 'HXxyz', {
        '1': 'Maria',
      });
      await processor.handleSendWhatsapp(job);

      expect(mockSendLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+5511988887777',
          body: expect.stringContaining('HXxyz'),
          template: 'HXxyz',
          notificationType: NotificationSendType.TEMPLATE,
        }),
      );
    });

    it('deve marcar status SENT para template job no modo dev', async () => {
      const job = createTemplateJob('+5511977776666', 'HXtest', { '1': 'X' });
      await processor.handleSendWhatsapp(job);

      const savedLog = mockSendLogRepository.save.mock.calls[0][0];
      expect(savedLog.status).toBe(NotificationSendStatus.SENT);
      expect(savedLog.sent_at).toBeInstanceOf(Date);
    });

    it('deve salvar errorMessage null no modo dev (sem falha)', async () => {
      const job = createJob('+5511999999999', 'Teste');
      await processor.handleSendWhatsapp(job);

      const savedLog = mockSendLogRepository.save.mock.calls[0][0];
      expect(savedLog.error_message).toBeNull();
    });

    it('deve normalizar telefone BR para E.164', async () => {
      const job = createJob('21987654321', 'Teste E164');
      await processor.handleSendWhatsapp(job);

      expect(mockSendLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+5521987654321',
        }),
      );
    });
  });
});
