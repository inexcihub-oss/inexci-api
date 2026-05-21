import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { AiRedisService } from '../ai-redis.service';
import { EmbeddingService } from '../../../rag/embedding.service';

export interface HybridSearchResult {
  id: string;
  category: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  score: number;
  retrievalMode: 'hybrid';
}

@Injectable()
export class RagHybridSearchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly aiRedis: AiRedisService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(input: {
    query: string;
    category?: string;
    limit?: number;
  }): Promise<HybridSearchResult[]> {
    const limit = input.limit ?? 5;
    const cacheKey = this.buildCacheKey(input.query, input.category, limit);
    const cached = await this.aiRedis.cacheGet<HybridSearchResult[]>(cacheKey);
    if (cached?.length) return cached;

    const embedding = await this.embeddingService.generate(input.query);
    const rows = (await this.dataSource.query(
      `
        WITH vector_hits AS (
          SELECT
            id,
            category,
            title,
            content,
            metadata,
            ROW_NUMBER() OVER (ORDER BY embedding::vector <=> $1::vector ASC) AS vec_rank
          FROM ai_knowledge_chunks
          WHERE active = true
            AND ($2::text IS NULL OR category = $2)
          LIMIT $3
        ),
        lexical_hits AS (
          SELECT
            id,
            category,
            title,
            content,
            metadata,
            ROW_NUMBER() OVER (
              ORDER BY ts_rank_cd(content_tsv, plainto_tsquery('portuguese', $4)) DESC
            ) AS lex_rank
          FROM ai_knowledge_chunks
          WHERE active = true
            AND ($2::text IS NULL OR category = $2)
            AND content_tsv @@ plainto_tsquery('portuguese', $4)
          LIMIT $3
        ),
        merged AS (
          SELECT
            COALESCE(v.id, l.id) AS id,
            COALESCE(v.category, l.category) AS category,
            COALESCE(v.title, l.title) AS title,
            COALESCE(v.content, l.content) AS content,
            COALESCE(v.metadata, l.metadata) AS metadata,
            (COALESCE(1.0 / (60 + v.vec_rank), 0) + COALESCE(1.0 / (60 + l.lex_rank), 0)) AS score
          FROM vector_hits v
          FULL OUTER JOIN lexical_hits l ON l.id = v.id
        )
        SELECT *
        FROM merged
        ORDER BY score DESC
        LIMIT $3
      `,
      [
        this.embeddingService.toSqlVector(embedding),
        input.category ?? null,
        limit,
        input.query,
      ],
    )) as Array<{
      id: string;
      category: string;
      title: string;
      content: string;
      metadata: Record<string, unknown> | null;
      score: string | number;
    }>;

    const results = rows.map((row) => ({
      ...row,
      score: Number(row.score || 0),
      retrievalMode: 'hybrid' as const,
    }));

    await this.aiRedis.cacheSet(cacheKey, results, 300);
    return results;
  }

  private buildCacheKey(
    query: string,
    category: string | undefined,
    limit: number,
  ): string {
    return `rag:hybrid:${createHash('sha1')
      .update(query.trim().toLowerCase())
      .update('|')
      .update(category ?? 'all')
      .update('|')
      .update(String(limit))
      .digest('hex')}`;
  }
}
