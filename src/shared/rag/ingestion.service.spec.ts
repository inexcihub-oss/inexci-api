import { IngestionService } from './ingestion.service';
import { EmbeddingService } from './embedding.service';
import { AiKnowledgeChunkRepository } from '../../database/repositories/ai-knowledge-chunk.repository';

describe('IngestionService', () => {
  it('gera cada embedding com source rag_ingestion e owner nulo', async () => {
    const embedding = {
      generate: jest.fn().mockResolvedValue([0.1]),
      toSqlVector: jest.fn().mockReturnValue('[0.1]'),
    };
    const repo = { create: jest.fn().mockResolvedValue({}) };
    const service = new IngestionService(
      embedding as unknown as EmbeddingService,
      repo as unknown as AiKnowledgeChunkRepository,
    );

    await service.ingest({ category: 'faq', title: 'T', content: 'conteudo' });

    expect(embedding.generate).toHaveBeenCalledWith('conteudo', {
      source: 'rag_ingestion',
      ownerId: null,
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});
