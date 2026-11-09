import { Injectable, Optional } from '@nestjs/common';
import { OpenaiService } from '../ai/services/openai.service';
import { AiUsageRecorder } from '../ai/usage/ai-usage.recorder';
import { AiUsageSource } from '../../database/entities/ai-token-usage-log.entity';

export interface EmbeddingUsageContext {
  source: Extract<AiUsageSource, 'rag_embedding' | 'rag_ingestion'>;
  ownerId: string | null;
  userId?: string | null;
}

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly openaiService: OpenaiService,
    @Optional() private readonly usageRecorder?: AiUsageRecorder,
  ) {}

  async generate(
    text: string,
    usage?: EmbeddingUsageContext,
  ): Promise<number[]> {
    if (!usage) return this.openaiService.createEmbedding(text);

    const startedAt = Date.now();
    const result = await this.openaiService.createEmbeddingWithUsage(text);
    await this.usageRecorder?.record({
      source: usage.source,
      ownerId: usage.ownerId,
      userId: usage.userId ?? null,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: 0,
      latencyMs: Date.now() - startedAt,
      stage: 'embedding',
    });
    return result.embedding;
  }

  toSqlVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
