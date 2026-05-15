import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 5 do Blueprint v3 — cache de OCR/classificação por SHA256.
 *
 * Permite que o mesmo PDF/imagem reenviado evite OCR + classifier +
 * vision fallback (3 chamadas OpenAI no pior caso). Hit-rate esperado:
 * 10-25% nos picos de uso (mesmo doc reenviado por engano, ou por
 * múltiplos colaboradores da mesma clínica).
 *
 * Schema: chave primária pelo hash. `byte_size` permite validação
 * dupla (defesa contra colisão SHA256, embora desprezível). `hit_count`
 * mostra os caches "quentes" para análise.
 *
 * TTL: limpeza por job assíncrono (90 dias). Implementado em
 * `OcrDocCacheCleanupService` (FOLLOW-UP — esta migration apenas
 * adiciona a tabela e o índice de `created_at` para varredura O(N)
 * no cleanup).
 */
export class CreateAiDocCache1747400000000 implements MigrationInterface {
  name = 'CreateAiDocCache1747400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_doc_cache" (
        "sha256"           CHAR(64) NOT NULL,
        "mime"             TEXT NOT NULL,
        "byte_size"        INT NOT NULL,
        "ocr_text"         TEXT,
        "ocr_confidence"   NUMERIC(3,2),
        "classification"   JSONB,
        "extraction"       JSONB,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_hit_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "hit_count"        INT NOT NULL DEFAULT 0,
        CONSTRAINT "pk_ai_doc_cache" PRIMARY KEY ("sha256")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_doc_cache_created_at"
         ON "ai_doc_cache" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_doc_cache_last_hit_at"
         ON "ai_doc_cache" ("last_hit_at");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_doc_cache_last_hit_at";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_doc_cache_created_at";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_doc_cache";`);
  }
}
