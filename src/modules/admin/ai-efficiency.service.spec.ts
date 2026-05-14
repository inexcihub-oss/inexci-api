import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiEfficiencyService } from './ai-efficiency.service';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';

describe('AiEfficiencyService', () => {
  let service: AiEfficiencyService;
  let queries: Array<{ sql: string; params: unknown[] }>;
  let mockResults: any[][];

  const mockRepo = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    queries = [];
    mockResults = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiEfficiencyService,
        {
          provide: getRepositoryToken(AiTokenUsageLog),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<AiEfficiencyService>(AiEfficiencyService);

    mockRepo.query.mockImplementation((sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve(mockResults.shift() ?? []);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function pushBaseResults(
    overrides: {
      totals?: any;
      cache?: any;
      stages?: any;
      byDraft?: any[];
      calls?: any[];
      rag?: any;
    } = {},
  ) {
    mockResults.push(
      [
        overrides.totals ?? {
          totalTurns: 10,
          totalConversations: 4,
          totalUsers: 3,
          avgPromptTokens: 5000,
          avgCompletionTokens: 250,
          avgTotalTokens: 5250,
          p50TotalTokens: 5000,
          p95TotalTokens: 8000,
          avgLatencyMs: 4200,
          p50LatencyMs: 3500,
          p95LatencyMs: 9000,
          avgCallsPerTurn: 2.4,
          totalCostCents: 120,
          avgCostCents: 12,
        },
      ],
      [
        overrides.cache ?? {
          totalCachedTokens: 6000,
          sumPromptInBreakdown: 20000,
        },
      ],
      [
        overrides.stages ?? {
          turnsWithRewrite: 3,
          turnsWithSummary: 2,
          totalTurns: 10,
        },
      ],
      overrides.byDraft ?? [
        {
          draftType: 'create_sc',
          turns: 6,
          avgPromptTokens: 5500,
          avgTotalTokens: 5800,
          cachedTokens: 4000,
          sumPromptTokens: 12000,
        },
        {
          draftType: 'none',
          turns: 4,
          avgPromptTokens: 4250,
          avgTotalTokens: 4400,
          cachedTokens: 2000,
          sumPromptTokens: 8000,
        },
      ],
      overrides.calls ?? [
        { calls: 1, turns: 4 },
        { calls: 2, turns: 4 },
        { calls: 3, turns: 2 },
      ],
      // Fase 7: métricas RAG
      [
        overrides.rag ?? {
          totalTurnsWithRagData: 8,
          turnsWithRagHit: 6,
          avgRagScore: 0.74,
        },
      ],
    );
  }

  it('agrega métricas básicas e calcula cache hit rate em %', async () => {
    pushBaseResults();

    const report = await service.getReport({});

    expect(report.totalTurns).toBe(10);
    expect(report.totalConversations).toBe(4);
    expect(report.totalUsers).toBe(3);
    expect(report.avgPromptTokens).toBe(5000);
    expect(report.p95TotalTokens).toBe(8000);
    expect(report.p50LatencyMs).toBe(3500);
    expect(report.p95LatencyMs).toBe(9000);
    expect(report.avgCallsPerTurn).toBe(2.4);
    // 6000 / 20000 = 30 %
    expect(report.cacheHitRate).toBe(30);
    expect(report.totalCachedTokens).toBe(6000);
    // 3 / 10 = 30 %
    expect(report.rewriteRate).toBe(30);
    expect(report.summaryStageRate).toBe(20);
    expect(report.totalCostCents).toBe(120);
    expect(report.avgCostCents).toBe(12);
  });

  it('quebra por draftType com cache hit rate por grupo', async () => {
    pushBaseResults();

    const report = await service.getReport({});

    expect(report.byDraftType).toHaveLength(2);
    expect(report.byDraftType[0]).toEqual({
      draftType: 'create_sc',
      turns: 6,
      avgPromptTokens: 5500,
      avgTotalTokens: 5800,
      // 4000 / 12000 = 33.3 %
      cacheHitRate: 33.3,
    });
    expect(report.byDraftType[1].cacheHitRate).toBe(25);
  });

  it('distribuição de iterations devolve % por bucket', async () => {
    pushBaseResults();

    const report = await service.getReport({});

    expect(report.callsDistribution).toEqual([
      { calls: 1, turns: 4, percent: 40 },
      { calls: 2, turns: 4, percent: 40 },
      { calls: 3, turns: 2, percent: 20 },
    ]);
  });

  it('aplica filtros from/to e converte para placeholders posicionais', async () => {
    pushBaseResults();

    await service.getReport({ from: '2026-05-01', to: '2026-05-31' });

    expect(queries).toHaveLength(6);
    for (const q of queries) {
      expect(q.sql).toContain('WHERE');
      expect(q.sql).toMatch(/\$1/);
      expect(q.sql).toMatch(/\$2/);
      expect(q.sql).not.toMatch(/:from|:to/);
      expect(q.params).toEqual(['2026-05-01', '2026-05-31']);
    }
  });

  // ─── bindNamed (via getReport + query spy) ───────────────────────────────

  describe('bindNamed — robustez contra casts e strings SQL', () => {
    /**
     * Acessa `bindNamed` de forma indireta: injetamos um SQL fabricado como
     * sobrecarga de mock e inspecionamos o SQL que chega ao `repo.query`.
     * Como `bindNamed` é privado, testamos via caixa-preta (getReport).
     * Para contornar isso, instanciamos o service e chamamos o método
     * protegido via cast deliberado — aceitável em contexto de teste unitário.
     */
    it('não substitui casts :: como ::int, ::vector, ::float', () => {
      const svc = service as any;
      const { sql } = svc.bindNamed(
        'SELECT val::int, emb::vector FROM t WHERE id = :id',
        { id: '42' },
      );
      expect(sql).toContain('::int');
      expect(sql).toContain('::vector');
      expect(sql).not.toContain('$2');
      expect(sql).toContain('$1');
    });

    it('não substitui dois-pontos dentro de literais de string', () => {
      const svc = service as any;
      const { sql } = svc.bindNamed(
        "SELECT * FROM t WHERE tag = 'foo:bar' AND name = :name",
        { name: 'test' },
      );
      expect(sql).toContain("'foo:bar'");
      expect(sql).toContain('$1');
    });

    it('substitui nomes que coincidem com palavras reservadas SQL (:select, :from)', () => {
      const svc = service as any;
      const { sql, params } = svc.bindNamed(
        'SELECT * FROM t WHERE col = :from AND col2 = :select',
        { from: 'A', select: 'B' },
      );
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).not.toContain(':from');
      expect(sql).not.toContain(':select');
      expect(params).toEqual(['A', 'B']);
    });

    it('deduplicates: mesma chave aparecendo duas vezes usa o mesmo $N', () => {
      const svc = service as any;
      const { sql, params } = svc.bindNamed('WHERE a = :x AND b = :x', {
        x: 'val',
      });
      expect(sql).toBe('WHERE a = $1 AND b = $1');
      expect(params).toEqual(['val']);
    });

    it('preserva placeholder literal quando a chave não está em args', () => {
      const svc = service as any;
      const { sql } = svc.bindNamed('WHERE a = :unknown', {});
      expect(sql).toContain(':unknown');
    });
  });

  it('quando não há dados retorna 0 sem dividir por zero', async () => {
    pushBaseResults({
      totals: {
        totalTurns: 0,
        totalConversations: 0,
        totalUsers: 0,
        avgPromptTokens: 0,
        avgCompletionTokens: 0,
        avgTotalTokens: 0,
        p50TotalTokens: 0,
        p95TotalTokens: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        avgCallsPerTurn: 0,
        totalCostCents: 0,
        avgCostCents: 0,
      },
      cache: { totalCachedTokens: 0, sumPromptInBreakdown: 0 },
      stages: { turnsWithRewrite: 0, turnsWithSummary: 0, totalTurns: 0 },
      byDraft: [],
      calls: [],
    });

    const report = await service.getReport({});

    expect(report.totalTurns).toBe(0);
    expect(report.cacheHitRate).toBe(0);
    expect(report.rewriteRate).toBe(0);
    expect(report.summaryStageRate).toBe(0);
    expect(report.byDraftType).toEqual([]);
    expect(report.callsDistribution).toEqual([]);
    expect(report.avgCostCents).toBeNull();
  });
});
