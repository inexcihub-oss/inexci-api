import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela `ai_knowledge_chunk` (RAG) com coluna `embedding vector(1536)`
 * e índice IVFFlat. Foi separada da `InitialSchema` para isolar a dependência
 * direta de `pgvector` do schema base e permitir evolução independente
 * (por exemplo, troca para HNSW quando a base ultrapassar ~10k chunks).
 *
 * Em ambientes que já rodaram a versão anterior da `InitialSchema` (que criava
 * a tabela inline), o `CREATE TABLE IF NOT EXISTS` é idempotente. O bloco
 * `DO $$ ... $$` ajusta a coluna `metadata` de TEXT para JSONB se necessário,
 * preservando compatibilidade com a entidade `AiKnowledgeChunk`.
 *
 * Pré-requisito: extensão `vector` instalada (validada na InitialSchema).
 */
export class CreateAiKnowledgeChunkVector1763200000000 implements MigrationInterface {
  name = 'CreateAiKnowledgeChunkVector1763200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const vectorInstalled = await queryRunner
      .query(`SELECT 1 FROM pg_extension WHERE extname = 'vector' LIMIT 1`)
      .catch(() => []);

    if (!vectorInstalled.length) {
      throw new Error(
        'Extensão "vector" (pgvector) não está instalada. ' +
          'Use a imagem `pgvector/pgvector:pg16` ou rode ' +
          '`CREATE EXTENSION vector;` antes de aplicar esta migration.',
      );
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_knowledge_chunk" (
        "id"         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "category"   VARCHAR(50) NOT NULL,
        "title"      TEXT NOT NULL,
        "content"    TEXT NOT NULL,
        "metadata"   JSONB,
        "embedding"  vector(1536),
        "active"     BOOLEAN DEFAULT true,
        "created_at" TIMESTAMPTZ DEFAULT now(),
        "updated_at" TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Compatibilidade com instalações anteriores cujo `metadata` foi criado
    // como TEXT. Convertendo o tipo de TEXT para JSONB sem perder dados.
    await queryRunner.query(`
      DO $$
      DECLARE
        col_type text;
      BEGIN
        SELECT data_type INTO col_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ai_knowledge_chunk'
          AND column_name = 'metadata';

        IF col_type IS NOT NULL AND col_type <> 'jsonb' THEN
          ALTER TABLE "ai_knowledge_chunk"
            ALTER COLUMN "metadata" TYPE jsonb
            USING (
              CASE
                WHEN "metadata" IS NULL THEN NULL
                WHEN "metadata" = '' THEN NULL
                ELSE "metadata"::jsonb
              END
            );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_knowledge_embedding"
      ON "ai_knowledge_chunk"
      USING ivfflat ("embedding" vector_cosine_ops)
      WITH (lists = 100);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_knowledge_category_active"
      ON "ai_knowledge_chunk" ("category", "active");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_knowledge_category_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_knowledge_embedding"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ai_knowledge_chunk" CASCADE`,
    );
  }
}
