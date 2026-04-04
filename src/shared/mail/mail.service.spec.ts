import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: getQueueToken('mail'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── PRD: Modal Confirmação Notificação — US-004 / US-005 ────────────────
  describe('sendStatusUpdate', () => {
    const statusContext = {
      patientName: 'João Silva',
      requestId: 'REQ-001',
      oldStatus: 'Pendente',
      newStatus: 'Enviada',
      changedAt: '02/04/2026 14:30',
    };

    it('deve enfileirar email de status-update com template correto', async () => {
      await service.sendStatusUpdate('joao@email.com', statusContext);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-mail',
        expect.objectContaining({
          template: 'status-update',
          to: 'joao@email.com',
          subject: 'Atualização de Status da Solicitação',
          context: statusContext,
        }),
        expect.any(Object),
      );
    });

    it('deve incluir nome do paciente no contexto', async () => {
      await service.sendStatusUpdate('paciente@email.com', statusContext);

      const jobData = mockQueue.add.mock.calls[0][1];
      expect(jobData.context.patientName).toBe('João Silva');
    });

    it('deve incluir status anterior e novo no contexto', async () => {
      await service.sendStatusUpdate('paciente@email.com', statusContext);

      const jobData = mockQueue.add.mock.calls[0][1];
      expect(jobData.context.oldStatus).toBe('Pendente');
      expect(jobData.context.newStatus).toBe('Enviada');
    });

    it('deve incluir data da alteração no contexto', async () => {
      await service.sendStatusUpdate('paciente@email.com', statusContext);

      const jobData = mockQueue.add.mock.calls[0][1];
      expect(jobData.context.changedAt).toBe('02/04/2026 14:30');
    });

    it('não deve propagar exceção se fila falhar (FR-5)', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis offline'));

      await expect(
        service.sendStatusUpdate('paciente@email.com', statusContext),
      ).resolves.toBeUndefined();
    });
  });

  // ─── Testes gerais do send ───────────────────────────────────────────────
  describe('send', () => {
    it('deve enfileirar email com configuração de retry', async () => {
      await service.send('surgery-request-sent', 'test@email.com', 'Assunto', {
        key: 'value',
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-mail',
        expect.objectContaining({
          template: 'surgery-request-sent',
          to: 'test@email.com',
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });
  });
});
