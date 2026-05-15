import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 6 do Blueprint v3 — RAG hybrid search.
 *
 * Adiciona coluna `content_tsv` (tsvector) gerada automaticamente a
 * partir de `title` + `content`, com índice GIN para busca full-text
 * BM25-style via `ts_rank_cd`.
 *
 * O `RagHybridSearchService` combina cosine (vector) + BM25 (tsvector)
 * via Reciprocal Rank Fusion (k=60), aumentando recall em consultas
 * curtas/factuais sem perder a semântica do embedding.
 *
 * Configuração: `pg_catalog.portuguese` (já vem com Postgres). Se a
 * extensão `unaccent` estiver disponível, usar `unaccent(...)` no
 * vetor é melhor — fica como FOLLOW-UP.
 */
export class AddTsvectorToAiKnowledgeChunks1747600000000
  implements MigrationInterface
{
  name = 'AddTsvectorToAiKnowledgeChunks1747600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_knowledge_chunks"
        ADD COLUMN IF NOT EXISTS "content_tsv" TSVECTOR
        GENERATED ALWAYS AS (
          to_tsvector(
            'pg_catalog.portuguese',
            COALESCE("title",'') || ' ' || COALESCE("content",'')
          )
        ) STORED;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_knowledge_content_tsv"
        ON "ai_knowledge_chunks" USING GIN ("content_tsv");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_knowledge_content_tsv";`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_knowledge_chunks" DROP COLUMN IF EXISTS "content_tsv";`,
    );
  }
}
