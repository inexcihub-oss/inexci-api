import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagService, RagSearchResult } from './rag.service';
import { EmbeddingService } from './embedding.service';
import { DataSource } from 'typeorm';

/**
 * Spec para as funcionalidades adicionadas na Fase 7 do
 * `PLANO-SANITIZACAO-CLEAN-CODE-IA.md`:
 *  - rerank por keyword overlap
 *  - computeMetrics
 *  - filtro de categoria
 *  - configurabilidade de topK/minScore
 */

const mockEmbeddingService = {
  generate: jest.fn(),
  toSqlVector: jest.fn(),
};

const mockDataSource = {
  query: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultVal: unknown) => defaultVal),
};

function makeResult(
  overrides: Partial<RagSearchResult> & { score: number },
): RagSearchResult {
  return {
    id: overrides.id ?? '1',
    title: overrides.title ?? 'Título',
    content: overrides.content ?? 'Conteúdo padrão',
    category: overrides.category ?? 'faq',
    score: overrides.score,
  };
}

describe('RagService — rerank (Fase 7)', () => {
  let service: RagService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
    jest.clearAllMocks();
  });

  // ─── rerank ──────────────────────────────────────────────────────────────────

  describe('rerank', () => {
    it('mantém resultado único sem alterar', () => {
      const single = [
        makeResult({ score: 0.8, content: 'chunking de tokens' }),
      ];
      expect(service.rerank(single, 'chunking')).toEqual(single);
    });

    it('mantém array vazio', () => {
      expect(service.rerank([], 'qualquer query')).toEqual([]);
    });

    it('reordena: resultado com mais keyword overlap sobe na lista mesmo com score coseno menor', () => {
      const highCosine = makeResult({
        id: 'a',
        score: 0.9,
        content: 'conceito sem relação com a pergunta do usuário',
      });
      const highOverlap = makeResult({
        id: 'b',
        score: 0.7,
        content: 'autorização de cirurgia e procedimento cirúrgico',
      });

      const reranked = service.rerank(
        [highCosine, highOverlap],
        'autorização cirurgia procedimento',
      );

      // highOverlap: cosine=0.7, overlap ~3/3 = 1.0  → 0.7*0.7 + 0.3*1.0 = 0.79
      // highCosine:  cosine=0.9, overlap ~0/3 = 0.0  → 0.7*0.9 + 0.3*0.0 = 0.63
      expect(reranked[0].id).toBe('b');
      expect(reranked[1].id).toBe('a');
    });

    it('não altera ordem quando todos os resultados têm mesmo overlap', () => {
      const r1 = makeResult({ id: '1', score: 0.9, content: 'texto genérico' });
      const r2 = makeResult({
        id: '2',
        score: 0.8,
        content: 'outro texto genérico',
      });
      const r3 = makeResult({
        id: '3',
        score: 0.7,
        content: 'mais um texto genérico',
      });

      // query sem palavras >= 3 chars → extractKeywords retorna []
      const result = service.rerank([r1, r2, r3], 'X Y');
      expect(result).toEqual([r1, r2, r3]);
    });

    it('score combinado = 0.7 * cosine + 0.3 * keyword_overlap', () => {
      const r1 = makeResult({
        id: '1',
        score: 0.8,
        content: 'agendamento cirurgia',
      });
      const r2 = makeResult({
        id: '2',
        score: 0.75,
        content: 'cirurgia agendamento procedimento médico',
      });

      const reranked = service.rerank([r1, r2], 'agendamento cirurgia');
      // r1: 0.7*0.8 + 0.3*(2/2) = 0.56 + 0.30 = 0.86
      // r2: 0.7*0.75 + 0.3*(2/2) = 0.525 + 0.30 = 0.825
      expect(reranked[0].id).toBe('1');
      expect(reranked[1].id).toBe('2');
    });

    it('ignora palavras curtas (< 3 chars) na extração de keywords', () => {
      const r1 = makeResult({
        id: '1',
        score: 0.7,
        content: 'documento exame resultado',
      });
      const r2 = makeResult({
        id: '2',
        score: 0.9,
        content: 'texto completamente diferente',
      });

      // "de a" → nenhuma keyword >= 3 chars → overlap = [] → mantém cosine order
      const result = service.rerank([r1, r2], 'de a');
      expect(result[0].id).toBe('1'); // ordem original preservada (mesmo overlap)
    });
  });

  // ─── computeMetrics ──────────────────────────────────────────────────────────

  describe('computeMetrics', () => {
    it('retorna zeros para array vazio', () => {
      const metrics = service.computeMetrics([]);
      expect(metrics).toEqual({ hitsCount: 0, topScore: 0, avgScore: 0 });
    });

    it('calcula corretamente com 1 resultado', () => {
      const metrics = service.computeMetrics([makeResult({ score: 0.85 })]);
      expect(metrics.hitsCount).toBe(1);
      expect(metrics.topScore).toBe(0.85);
      expect(metrics.avgScore).toBe(0.85);
    });

    it('calcula corretamente com múltiplos resultados', () => {
      const metrics = service.computeMetrics([
        makeResult({ score: 0.9 }),
        makeResult({ score: 0.8 }),
        makeResult({ score: 0.7 }),
      ]);
      expect(metrics.hitsCount).toBe(3);
      expect(metrics.topScore).toBe(0.9);
      expect(metrics.avgScore).toBeCloseTo(0.8, 3);
    });

    it('arredonda topScore e avgScore para 3 casas decimais', () => {
      const metrics = service.computeMetrics([
        makeResult({ score: 0.7777 }),
        makeResult({ score: 0.8333 }),
      ]);
      expect(metrics.topScore).toBe(0.833);
      // (0.7777 + 0.8333) / 2 = 0.8055 → Math.round(805.5) = 806 → 0.806
      expect(metrics.avgScore).toBe(0.806);
    });
  });

  // ─── search com opções ───────────────────────────────────────────────────────

  describe('search — configurabilidade (Fase 7)', () => {
    beforeEach(() => {
      mockEmbeddingService.generate.mockResolvedValue([0.1]);
      mockEmbeddingService.toSqlVector.mockReturnValue('[0.1]');
    });

    it('usa topK e minScore do ConfigService quando não passados', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'AI_RAG_TOP_K') return 5;
        if (key === 'AI_RAG_MIN_SCORE') return 0.7;
        return undefined;
      });
      mockDataSource.query.mockResolvedValue([]);

      await service.search('query de teste');

      const [sql, params] = mockDataSource.query.mock.calls[0];
      expect(params[1]).toBe(0.7); // minScore
      expect(params[2]).toBe(5); // topK
      expect(sql).not.toContain('category =');
    });

    it('filtro de categoria inclui WHERE category = $4 quando passado', async () => {
      mockConfigService.get.mockReturnValue(3);
      mockDataSource.query.mockResolvedValue([]);

      await service.search('query', { category: 'workflow' });

      const [sql, params] = mockDataSource.query.mock.calls[0];
      expect(sql).toContain('AND category = $4');
      expect(params[3]).toBe('workflow');
    });

    it('NÃO inclui filtro de categoria na query quando não passado', async () => {
      mockConfigService.get.mockReturnValue(3);
      mockDataSource.query.mockResolvedValue([]);

      await service.search('query');

      const [sql] = mockDataSource.query.mock.calls[0];
      expect(sql).not.toContain('category =');
    });

    it('aceita interface legada (query, topK, minScore) sem quebrar', async () => {
      mockConfigService.get.mockReturnValue(3);
      mockDataSource.query.mockResolvedValue([]);

      await service.search('query legada', 7, 0.55);

      const [, params] = mockDataSource.query.mock.calls[0];
      expect(params[2]).toBe(7); // topK
      expect(params[1]).toBe(0.55); // minScore
    });

    it('aplica rerank nos resultados retornados pelo banco', async () => {
      mockConfigService.get.mockReturnValue(3);
      mockDataSource.query.mockResolvedValue([
        makeResult({ id: 'x', score: 0.9, content: 'texto genérico' }),
        makeResult({ id: 'y', score: 0.7, content: 'autorização cirurgia' }),
      ]);

      const results = await service.search('cirurgia autorização');

      // 'y' tem maior overlap → deve subir para posição 0 após rerank
      expect(results[0].id).toBe('y');
      expect(results[1].id).toBe('x');
    });

    it('retorna vazio silenciosamente em caso de erro de DB', async () => {
      mockConfigService.get.mockReturnValue(3);
      mockDataSource.query.mockRejectedValue(new Error('DB error'));

      const results = await service.search('query com erro');
      expect(results).toHaveLength(0);
    });
  });
});
