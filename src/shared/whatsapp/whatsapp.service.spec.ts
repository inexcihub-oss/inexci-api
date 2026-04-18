import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';

describe('WhatsappService', () => {
  let service: WhatsappService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappService,
        {
          provide: getQueueToken('whatsapp-messages'),
          useValue: mockQueue,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'DASHBOARD_URL') return 'http://localhost:3000';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WhatsappService>(WhatsappService);
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── PRD: Comunicação WhatsApp — US-001 ──────────────────────────────────
  describe('sendMessage', () => {
    it('deve enfileirar mensagem na queue com configuração correta', async () => {
      await service.sendMessage('+5511999999999', 'Olá!');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-whatsapp',
        { to: '+5511999999999', body: 'Olá!' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );
    });

    it('não deve propagar exceção se a fila falhar (FR-4)', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis offline'));

      await expect(
        service.sendMessage('+5511999999999', 'Olá!'),
      ).resolves.toBeUndefined();
    });

    it('deve enfileirar com retry de 3 tentativas (FR-5)', async () => {
      await service.sendMessage('+5511999999999', 'Mensagem teste');

      const callArgs = mockQueue.add.mock.calls[0];
      expect(callArgs[2].attempts).toBe(3);
      expect(callArgs[2].backoff).toEqual({
        type: 'exponential',
        delay: 5000,
      });
    });
  });

  // ─── PRD: Comunicação WhatsApp — INC-04 (templates pré-aprovados) ────────
  describe('sendTemplate', () => {
    it('deve enfileirar job com contentSid e variables', async () => {
      await service.sendTemplate(
        '+5511999999999',
        'HXabc123',
        { '1': 'João', '2': 'Em Análise', '3': 'Hospital Geral' },
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-whatsapp',
        {
          to: '+5511999999999',
          contentSid: 'HXabc123',
          variables: { '1': 'João', '2': 'Em Análise', '3': 'Hospital Geral' },
        },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );
    });

    it('não deve propagar exceção se a fila falhar', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis offline'));

      await expect(
        service.sendTemplate('+5511999999999', 'HXabc123', { '1': 'Teste' }),
      ).resolves.toBeUndefined();
    });

    it('não deve incluir campo body no job de template', async () => {
      await service.sendTemplate('+5511999999999', 'HXxyz', { '1': 'A' });

      const [, jobData] = mockQueue.add.mock.calls[0];
      expect(jobData.body).toBeUndefined();
      expect(jobData.contentSid).toBe('HXxyz');
    });
  });

  // ─── PRD: Comunicação WhatsApp — US-003 ──────────────────────────────────
  describe('sendPatientWelcome', () => {
    it('deve enviar mensagem de boas-vindas ao paciente com nome correto', async () => {
      await service.sendPatientWelcome('+5511988887777', 'João Silva');

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, jobData] = mockQueue.add.mock.calls[0];
      expect(jobData.to).toBe('+5511988887777');
      expect(jobData.body).toContain('João Silva');
      expect(jobData.body).toContain('Inexci');
      expect(jobData.body).toContain('WhatsApp');
    });

    it('deve incluir saudação com nome e informação sobre canal oficial', async () => {
      await service.sendPatientWelcome('+5511988887777', 'Maria');

      const [, jobData] = mockQueue.add.mock.calls[0];
      expect(jobData.body).toContain('Olá, Maria');
      expect(jobData.body).toContain('canal oficial');
    });
  });

  // ─── PRD: Comunicação WhatsApp — US-004 ──────────────────────────────────
  describe('sendDoctorWelcome', () => {
    it('deve enviar mensagem de boas-vindas ao médico com nome, email e link', async () => {
      await service.sendDoctorWelcome(
        '+5511977776666',
        'Dr. Carlos',
        'carlos@email.com',
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, jobData] = mockQueue.add.mock.calls[0];
      expect(jobData.to).toBe('+5511977776666');
      expect(jobData.body).toContain('Dr. Carlos');
      expect(jobData.body).toContain('carlos@email.com');
      expect(jobData.body).toContain('Inexci');
    });

    it('deve incluir link do dashboard para acesso', async () => {
      await service.sendDoctorWelcome(
        '+5511977776666',
        'Dra. Ana',
        'ana@email.com',
      );

      const [, jobData] = mockQueue.add.mock.calls[0];
      // Deve conter URL do dashboard (padrão ou env)
      expect(jobData.body).toMatch(/https?:\/\//);
    });

    it('deve informar login (email) ao médico', async () => {
      await service.sendDoctorWelcome(
        '+5511977776666',
        'Dr. Pedro',
        'pedro@inexci.com',
      );

      const [, jobData] = mockQueue.add.mock.calls[0];
      expect(jobData.body).toContain('pedro@inexci.com');
    });
  });
});
