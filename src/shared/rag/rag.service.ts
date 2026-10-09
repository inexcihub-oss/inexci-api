import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EmbeddingService } from './embedding.service';
import { inexciTracer, SpanStatusCode } from '../observability/tracer';

export interface RagSearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  score: number;
}

export interface RagQueryMetrics {
  hitsCount: number;
  topScore: number;
  avgScore: number;
}

export interface RagSearchOptions {
  topK?: number;
  minScore?: number;
  category?: string;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async search(
    query: string,
    opts?: RagSearchOptions,
  ): Promise<RagSearchResult[]>;

  async search(
    query: string,
    topK?: number,
    minScore?: number,
  ): Promise<RagSearchResult[]>;
  async search(
    query: string,
    optsOrTopK?: RagSearchOptions | number,
    legacyMinScore?: number,
  ): Promise<RagSearchResult[]> {
    const defaultTopK = this.configService.get<number>('AI_RAG_TOP_K', 3);
    const defaultMinScore = this.configService.get<number>(
      'AI_RAG_MIN_SCORE',
      0.65,
    );

    let topK: number;
    let minScore: number;
    let category: string | undefined;

    if (typeof optsOrTopK === 'object' && optsOrTopK !== null) {
      topK = optsOrTopK.topK ?? defaultTopK;
      minScore = optsOrTopK.minScore ?? defaultMinScore;
      category = optsOrTopK.category;
    } else {
      topK = optsOrTopK ?? defaultTopK;
      minScore = legacyMinScore ?? defaultMinScore;
    }

    return inexciTracer.startActiveSpan('rag.search', async (span) => {
      span.setAttribute('rag.topK', topK);
      span.setAttribute('rag.minScore', minScore);
      if (category) span.setAttribute('rag.category', category);
      try {
        const queryEmbedding = await this.embeddingService.generate(query);
        const vectorStr = this.embeddingService.toSqlVector(queryEmbedding);

        const sql = category
          ? `SELECT
            id, title, content, category,
            1 - (embedding <=> $1::vector) AS score
          FROM ai_knowledge_chunks
          WHERE active = true
            AND 1 - (embedding <=> $1::vector) > $2
            AND category = $4
          ORDER BY embedding <=> $1::vector
          LIMIT $3`
          : `SELECT
            id, title, content, category,
            1 - (embedding <=> $1::vector) AS score
          FROM ai_knowledge_chunks
          WHERE active = true
            AND 1 - (embedding <=> $1::vector) > $2
          ORDER BY embedding <=> $1::vector
          LIMIT $3`;

        const params = category
          ? [vectorStr, minScore, topK, category]
          : [vectorStr, minScore, topK];

        const results = await this.dataSource.query<RagSearchResult[]>(
          sql,
          params,
        );

        const reranked = this.rerank(results, query);
        span.setAttribute('rag.hits', reranked.length);
        if (reranked.length > 0)
          span.setAttribute('rag.top_score', reranked[0].score);
        span.setStatus({ code: SpanStatusCode.OK });
        return reranked;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
        this.logger.warn(`RAG search falhou: ${error?.message}`);
        return [];
      } finally {
        span.end();
      }
    });
  }

  computeMetrics(results: RagSearchResult[]): RagQueryMetrics {
    if (results.length === 0) {
      return { hitsCount: 0, topScore: 0, avgScore: 0 };
    }
    const scores = results.map((r) => Number(r.score) || 0);
    const topScore = Math.max(...scores);
    const avgScore = scores.reduce((acc, s) => acc + s, 0) / scores.length;
    return {
      hitsCount: results.length,
      topScore: Math.round(topScore * 1000) / 1000,
      avgScore: Math.round(avgScore * 1000) / 1000,
    };
  }

  async formatContext(results: RagSearchResult[]): Promise<string | undefined> {
    if (!results.length) return undefined;
    return results.map((r) => `[${r.category}] ${r.content}`).join('\n---\n');
  }

  rerank(results: RagSearchResult[], query: string): RagSearchResult[] {
    if (results.length <= 1) return results;

    const queryWords = this.extractKeywords(query);
    if (queryWords.length === 0) return results;

    const scored = results.map((r) => {
      const cosine = Number(r.score) || 0;
      const overlap = this.keywordOverlap(r.content, queryWords);
      const combined = 0.7 * cosine + 0.3 * overlap;
      return { result: r, combined };
    });

    scored.sort((a, b) => b.combined - a.combined);
    return scored.map((s) => s.result);
  }

  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3);
    return [...new Set(words)];
  }

  private keywordOverlap(content: string, queryWords: string[]): number {
    const lower = content.toLowerCase();
    const hits = queryWords.filter((w) => lower.includes(w)).length;
    return hits / queryWords.length;
  }
}
