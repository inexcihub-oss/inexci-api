import { AiUsageService } from './ai-usage.service';
import { AiTokenUsageLogRepository } from '../../database/repositories/ai-token-usage-log.repository';

describe('AiUsageService', () => {
  const repo = { report: jest.fn() };
  let service: AiUsageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiUsageService(repo as unknown as AiTokenUsageLogRepository);
  });

  it('repassa agrupamento e filtros ao repositório', async () => {
    const rows = [
      {
        groupKey: 'o1',
        name: 'Dr. A',
        email: 'a@x.com',
        totalPromptTokens: 1,
        totalCompletionTokens: 2,
        totalTokens: 3,
        totalCalls: 1,
        totalRecords: 1,
        costUsdCents: 4,
        avgLatencyMs: 10,
      },
    ];
    repo.report.mockResolvedValue(rows);
    const query = {
      groupBy: 'owner' as const,
      ownerId: '11111111-1111-1111-1111-111111111111',
      source: 'whatsapp' as const,
      from: '2026-10-01',
    };

    await expect(service.getReport(query)).resolves.toBe(rows);
    expect(repo.report).toHaveBeenCalledWith(query);
  });

  it('usa todas as origens quando source não é informado', async () => {
    repo.report.mockResolvedValue([]);

    await service.getReport({ groupBy: 'day' });

    expect(repo.report).toHaveBeenCalledWith({ groupBy: 'day' });
  });
});
