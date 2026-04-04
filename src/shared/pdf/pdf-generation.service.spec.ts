import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { PdfGenerationService } from './pdf-generation.service';

describe('PdfGenerationService', () => {
  let service: PdfGenerationService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfGenerationService,
        {
          provide: getQueueToken('pdf-generation'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<PdfGenerationService>(PdfGenerationService);
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── PRD: Registro PDF Histórico — US-001 ────────────────────────────────
  describe('scheduleGeneration', () => {
    it('deve enfileirar job de geração de PDF com dados corretos', async () => {
      await service.scheduleGeneration('request-123', 'user-456');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'generate-pdf',
        { surgeryRequestId: 'request-123', userId: 'user-456' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );
    });

    it('não deve propagar exceção se Redis/fila falhar (FR-5)', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis indisponível'));

      await expect(
        service.scheduleGeneration('request-123', 'user-456'),
      ).resolves.toBeUndefined();
    });

    it('deve configurar retry com 3 tentativas e backoff exponencial', async () => {
      await service.scheduleGeneration('req-1', 'usr-1');

      const jobOptions = mockQueue.add.mock.calls[0][2];
      expect(jobOptions.attempts).toBe(3);
      expect(jobOptions.backoff.type).toBe('exponential');
    });

    it('deve manter jobs que falharam para análise (removeOnFail: false)', async () => {
      await service.scheduleGeneration('req-1', 'usr-1');

      const jobOptions = mockQueue.add.mock.calls[0][2];
      expect(jobOptions.removeOnFail).toBe(false);
    });

    it('deve remover jobs completos (removeOnComplete: true)', async () => {
      await service.scheduleGeneration('req-1', 'usr-1');

      const jobOptions = mockQueue.add.mock.calls[0][2];
      expect(jobOptions.removeOnComplete).toBe(true);
    });
  });
});
