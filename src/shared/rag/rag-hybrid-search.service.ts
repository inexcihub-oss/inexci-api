import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EmbeddingService } from './embedding.service';
import { RagSearchResult } from './rag.service';

const RRF_K = 60;

interface RankedHit {
  id: string;
  rank: number;
  source: 'cosine' | 'bm25';
  score: number;
}

/**
 * Hybrid search BM25 + cosine + Reciprocal Rank Fusion (Fase 6 do Blueprint v3).
 *
 * Algoritmo:
 *   1. Roda 2 queries em paralelo: cosine (pgvector) e BM25 (`ts_rank_cd`).
 *   2. Fusiona via RRF: `score = sum(1 / (k + rank))` para cada doc presente em qualquer das listas.
 *   3. Retorna top-K do conjunto fundido.
 *
 * Vantagem vs `RagService.search` puro: cobre buscas factuais curtas
 * ("qual TUSS de artroplastia?") onde cosine sozinho pode errar mas
 * BM25 acerta — e vice-versa para perguntas semânticas.
 *
 * Mantém `RagService` legado intacto para rollout via flag.
 */
@Injectable()
export class RagHybridSearchService {
  private readonly logger = new Logger(RagHybridSearchService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async search(
    query: string,
    options: {
      topK?: number;
      category?: string;
      minScoreCosine?: number;
    } = {},
  ): Promise<RagSearchResult[]> {
    const topK = options.topK ?? this.configService.get<number>('AI_RAG_TOP_K', 3);
    const minScore =
      options.minScoreCosine ??
      this.configService.get<number>('AI_RAG_MIN_SCORE', 0.4);
    const fetchK = Math.max(topK * 4, 12);

    try {
      const [cosineHits, bm25Hits] = await Promise.all([
        this.cosineSearch(query, fetchK, minScore, options.category),
        this.bm25Search(query, fetchK, options.category),
      ]);

      const fused = this.reciprocalRankFusion(cosineHits, bm25Hits);
      const top = fused.slice(0, topK);

      const idsInOrder = top.map((h) => h.id);
      if (!idsInOrder.length) return [];

      const placeholders = idsInOrder.map((_, i) => `$${i + 1}`).join(',');
      const rows = await this.dataSource.query<
        Array<{ id: string; title: string; content: string; category: string }>
      >(
        `SELECT id, title, content, category FROM ai_knowledge_chunks WHERE id IN (${placeholders})`,
        idsInOrder,
      );

      const byId = new Map(rows.map((r) => [r.id, r]));
      const results: RagSearchResult[] = top
        .map((hit) => {
          const row = byId.get(hit.id);
          if (!row) return null;
          return {
            id: row.id,
            title: row.title,
            content: row.content,
            category: row.category,
            score: hit.score,
          };
        })
        .filter((r): r is RagSearchResult => r !== null);

      return results;
    } catch (err: any) {
      this.logger.warn(`RAG hybrid search falhou: ${err?.message || err}`);
      return [];
    }
  }

  private async cosineSearch(
    query: string,
    limit: number,
    minScore: number,
    category?: string,
  ): Promise<RankedHit[]> {
    const queryEmbedding = await this.embeddingService.generate(query);
    const vectorStr = this.embeddingService.toSqlVector(queryEmbedding);
    const sql = category
      ? `SELECT id, 1 - (embedding <=> $1::vector) AS score
         FROM ai_knowledge_chunks
         WHERE active = true
           AND 1 - (embedding <=> $1::vector) > $2
           AND category = $4
         ORDER BY embedding <=> $1::vector
         LIMIT $3`
      : `SELECT id, 1 - (embedding <=> $1::vector) AS score
         FROM ai_knowledge_chunks
         WHERE active = true
           AND 1 - (embedding <=> $1::vector) > $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`;
    const params = category
      ? [vectorStr, minScore, limit, category]
      : [vectorStr, minScore, limit];
    const rows = await this.dataSource.query<
      Array<{ id: string; score: string }>
    >(sql, params);
    return rows.map((row, i) => ({
      id: row.id,
      rank: i + 1,
      source: 'cosine',
      score: Number(row.score),
    }));
  }

  private async bm25Search(
    query: string,
    limit: number,
    category?: string,
  ): Promise<RankedHit[]> {
    const sql = category
      ? `SELECT id, ts_rank_cd(content_tsv, plainto_tsquery('pg_catalog.portuguese', $1)) AS score
         FROM ai_knowledge_chunks
         WHERE active = true
           AND content_tsv @@ plainto_tsquery('pg_catalog.portuguese', $1)
           AND category = $3
         ORDER BY score DESC
         LIMIT $2`
      : `SELECT id, ts_rank_cd(content_tsv, plainto_tsquery('pg_catalog.portuguese', $1)) AS score
         FROM ai_knowledge_chunks
         WHERE active = true
           AND content_tsv @@ plainto_tsquery('pg_catalog.portuguese', $1)
         ORDER BY score DESC
         LIMIT $2`;
    const params = category ? [query, limit, category] : [query, limit];
    const rows = await this.dataSource.query<
      Array<{ id: string; score: string }>
    >(sql, params);
    return rows.map((row, i) => ({
      id: row.id,
      rank: i + 1,
      source: 'bm25',
      score: Number(row.score),
    }));
  }

  /**
   * RRF: `score(d) = sum over rankers of (1 / (k + rank_d_in_r))`.
   * `k = 60` é o valor canônico (Cormack et al. 2009).
   */
  reciprocalRankFusion(
    cosine: RankedHit[],
    bm25: RankedHit[],
  ): Array<{ id: string; score: number }> {
    const scores = new Map<string, number>();
    for (const hit of cosine) {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (RRF_K + hit.rank));
    }
    for (const hit of bm25) {
      scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (RRF_K + hit.rank));
    }
    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);
  }
}
