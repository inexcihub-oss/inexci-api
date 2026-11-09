import { EmbeddingService } from './embedding.service';
import { OpenaiService } from '../ai/services/openai.service';
import { AiUsageRecorder } from '../ai/usage/ai-usage.recorder';

describe('EmbeddingService', () => {
  const openai = {
    createEmbedding: jest.fn(),
    createEmbeddingWithUsage: jest.fn(),
  };
  const recorder = { record: jest.fn() };
  let service: EmbeddingService;

  beforeEach(() => {
    jest.clearAllMocks();
    recorder.record.mockResolvedValue(undefined);
    openai.createEmbedding.mockResolvedValue([0.1, 0.2]);
    openai.createEmbeddingWithUsage.mockResolvedValue({
      embedding: [0.1, 0.2],
      model: 'text-embedding-3-small',
      promptTokens: 42,
    });
    service = new EmbeddingService(
      openai as unknown as OpenaiService,
      recorder as unknown as AiUsageRecorder,
    );
  });

  it('sem contexto de uso não grava nada', async () => {
    await expect(service.generate('texto')).resolves.toEqual([0.1, 0.2]);

    expect(openai.createEmbedding).toHaveBeenCalledWith('texto');
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('grava rag_embedding com ownerId e userId quando informados', async () => {
    await service.generate('pergunta', {
      source: 'rag_embedding',
      ownerId: 'owner-1',
      userId: 'user-1',
    });

    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'rag_embedding',
        ownerId: 'owner-1',
        userId: 'user-1',
        model: 'text-embedding-3-small',
        promptTokens: 42,
        completionTokens: 0,
        stage: 'embedding',
      }),
    );
  });

  it('grava rag_ingestion com owner nulo', async () => {
    await service.generate('chunk', { source: 'rag_ingestion', ownerId: null });

    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'rag_ingestion',
        ownerId: null,
        userId: null,
      }),
    );
  });

  it('falha do recorder não quebra a geração do embedding', async () => {
    const real = new AiUsageRecorder({
      create: jest.fn().mockRejectedValue(new Error('banco fora')),
    } as never);
    service = new EmbeddingService(openai as unknown as OpenaiService, real);

    await expect(
      service.generate('pergunta', {
        source: 'rag_embedding',
        ownerId: 'owner-1',
      }),
    ).resolves.toEqual([0.1, 0.2]);
  });
});
