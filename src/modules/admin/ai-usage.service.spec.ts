import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiUsageService } from './ai-usage.service';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';

describe('AiUsageService', () => {
  let service: AiUsageService;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };

  const mockRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiUsageService,
        {
          provide: getRepositoryToken(AiTokenUsageLog),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<AiUsageService>(AiUsageService);
    jest.clearAllMocks();
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  it('deve retornar relatório agrupado por dia (padrão)', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([
      {
        groupKey: '2026-05-07',
        totalPromptTokens: '1200',
        totalCompletionTokens: '800',
        totalTokens: '2000',
        totalCalls: '5',
        totalCostCents: '3',
        avgLatencyMs: '450',
      },
    ]);

    const result = await service.getReport({});

    expect(result).toEqual([
      {
        groupKey: '2026-05-07',
        totalPromptTokens: 1200,
        totalCompletionTokens: 800,
        totalTokens: 2000,
        totalCalls: 5,
        totalCostCents: 3,
        avgLatencyMs: 450,
      },
    ]);
    expect(mockQueryBuilder.groupBy).toHaveBeenCalled();
  });

  it('deve aplicar filtros from/to quando fornecidos', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([]);

    await service.getReport({
      from: '2026-05-01',
      to: '2026-05-31',
      groupBy: 'user',
    });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(2);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'log.created_at >= :from',
      { from: '2026-05-01' },
    );
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'log.created_at <= :to',
      { to: '2026-05-31' },
    );
  });

  it('deve agrupar por modelo quando solicitado', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([
      {
        groupKey: 'gpt-4o',
        totalPromptTokens: '5000',
        totalCompletionTokens: '3000',
        totalTokens: '8000',
        totalCalls: '20',
        totalCostCents: null,
        avgLatencyMs: null,
      },
    ]);

    const result = await service.getReport({ groupBy: 'model' });

    expect(result[0].groupKey).toBe('gpt-4o');
    expect(result[0].totalCostCents).toBeNull();
    expect(result[0].avgLatencyMs).toBeNull();
  });
});
