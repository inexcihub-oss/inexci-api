import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingService } from './embedding.service';

export interface RagSearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  score: number;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly dataSource: DataSource,
  ) {}

  async search(
    query: string,
    topK = 3,
    minScore = 0.65,
  ): Promise<RagSearchResult[]> {
    try {
      const queryEmbedding = await this.embeddingService.generate(query);
      const vectorStr = this.embeddingService.toSqlVector(queryEmbedding);

      const results = await this.dataSource.query<RagSearchResult[]>(
        `SELECT
          id, title, content, category,
          1 - (embedding <=> $1::vector) AS score
        FROM ai_knowledge_chunk
        WHERE active = true
          AND 1 - (embedding <=> $1::vector) > $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
        [vectorStr, minScore, topK],
      );

      return results;
    } catch (error: any) {
      // Se pgvector não estiver habilitado, retorna vazio silenciosamente
      this.logger.warn(`RAG search falhou: ${error?.message}`);
      return [];
    }
  }

  async formatContext(results: RagSearchResult[]): Promise<string | undefined> {
    if (!results.length) return undefined;
    return results.map((r) => `[${r.category}] ${r.content}`).join('\n---\n');
  }
}
