import { Test, TestingModule } from '@nestjs/testing';
import { RagService } from './rag.service';
import { EmbeddingService } from './embedding.service';
import { DataSource } from 'typeorm';

const mockEmbeddingService = {
  generate: jest.fn(),
  toSqlVector: jest.fn(),
};

const mockDataSource = {
  query: jest.fn(),
};

describe('RagService', () => {
  let service: RagService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
    jest.clearAllMocks();
  });

  it('deve retornar chunks relevantes para a query', async () => {
    const embedding = Array(1536).fill(0.1);
    mockEmbeddingService.generate.mockResolvedValue(embedding);
    mockEmbeddingService.toSqlVector.mockReturnValue('[0.1,...]');
    mockDataSource.query.mockResolvedValue([
      { id: '1', title: 'FAQ 1', content: 'Resposta 1', category: 'faq', score: 0.85 },
      { id: '2', title: 'FAQ 2', content: 'Resposta 2', category: 'faq', score: 0.72 },
    ]);

    const results = await service.search('Como funciona?');

    expect(results).toHaveLength(2);
    expect(results[0].score).toBe(0.85);
  });

  it('deve retornar array vazio se nenhum chunk relevante', async () => {
    mockEmbeddingService.generate.mockResolvedValue([]);
    mockEmbeddingService.toSqlVector.mockReturnValue('[]');
    mockDataSource.query.mockResolvedValue([]);

    const results = await service.search('Pergunta sem resultado', 3, 0.9);

    expect(results).toHaveLength(0);
  });

  it('deve retornar vazio silenciosamente em caso de erro', async () => {
    mockEmbeddingService.generate.mockRejectedValue(new Error('OpenAI error'));

    const results = await service.search('query com erro');

    expect(results).toHaveLength(0);
  });

  it('deve formatar contexto corretamente', async () => {
    const results = [
      { id: '1', title: 'T1', content: 'Conteúdo A', category: 'faq', score: 0.9 },
      { id: '2', title: 'T2', content: 'Conteúdo B', category: 'workflow', score: 0.8 },
    ];

    const context = await service.formatContext(results);

    expect(context).toContain('[faq] Conteúdo A');
    expect(context).toContain('[workflow] Conteúdo B');
  });

  it('deve retornar undefined se sem resultados para formatar', async () => {
    const context = await service.formatContext([]);
    expect(context).toBeUndefined();
  });
});
