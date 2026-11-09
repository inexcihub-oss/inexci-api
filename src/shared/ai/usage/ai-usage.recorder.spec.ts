import { AiUsageRecorder } from './ai-usage.recorder';
import { AiTokenUsageLogRepository } from '../../../database/repositories/ai-token-usage-log.repository';

describe('AiUsageRecorder', () => {
  const repo = { create: jest.fn() };
  let recorder: AiUsageRecorder;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.create.mockResolvedValue({});
    recorder = new AiUsageRecorder(
      repo as unknown as AiTokenUsageLogRepository,
    );
  });

  it('grava uma linha com source, tokens, custo e sem dados do WhatsApp', async () => {
    await recorder.record({
      source: 'document_extraction',
      ownerId: 'o1',
      userId: 'u1',
      model: 'gpt-4o',
      promptTokens: 4000,
      completionTokens: 1000,
      latencyMs: 900,
      stage: 'doc_classifier',
    });

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'document_extraction',
        ownerId: 'o1',
        userId: 'u1',
        messageSid: null,
        phoneHash: null,
        promptTokens: 4000,
        completionTokens: 1000,
        totalTokens: 5000,
        callsCount: 1,
        model: 'gpt-4o',
        latencyMs: 900,
        costEstimateCents: 2,
        breakdown: [
          expect.objectContaining({
            stage: 'doc_classifier',
            totalTokens: 5000,
          }),
        ],
      }),
    );
  });

  it('aceita ownerId nulo (ingestão da base de conhecimento) e custo nulo sem preço', async () => {
    await recorder.record({
      source: 'rag_ingestion',
      ownerId: null,
      userId: null,
      model: 'modelo-sem-preco',
      promptTokens: 10,
      completionTokens: 0,
      latencyMs: 5,
      stage: 'embedding',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'rag_ingestion',
        ownerId: null,
        userId: null,
        costEstimateCents: null,
      }),
    );
  });

  it('nunca propaga erro de gravação', async () => {
    repo.create.mockRejectedValue(new Error('banco fora'));

    await expect(
      recorder.record({
        source: 'rag_embedding',
        ownerId: 'o1',
        userId: 'u1',
        model: 'text-embedding-3-small',
        promptTokens: 10,
        completionTokens: 0,
        latencyMs: 5,
        stage: 'embedding',
      }),
    ).resolves.toBeUndefined();
  });
});
