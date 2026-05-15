import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiRoiArchitectureTables1747288800000 implements MigrationInterface {
  name = 'AddAiRoiArchitectureTables1747288800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_persistent_memories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "scope" varchar(32) NOT NULL,
        "key" varchar(120) NOT NULL,
        "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "confidence" numeric(5,4) NOT NULL DEFAULT 0.5,
        "last_accessed_at" timestamptz,
        "expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_persistent_memories_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_persistent_memory_user_scope_key"
      ON "ai_persistent_memories" ("user_id", "scope", "key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_persistent_memory_user_scope"
      ON "ai_persistent_memories" ("user_id", "scope")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_doc_cache" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fingerprint" varchar(64) NOT NULL,
        "content_type" varchar(120) NOT NULL,
        "intent" varchar(40),
        "extraction_source" varchar(32) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "hit_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_doc_cache_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_doc_cache_fingerprint"
      ON "ai_doc_cache" ("fingerprint")
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_token_usage_logs"
      ADD COLUMN IF NOT EXISTS "tier" varchar(32),
      ADD COLUMN IF NOT EXISTS "tools_invoked" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "planner_intent" varchar(64),
      ADD COLUMN IF NOT EXISTS "draft_type" varchar(64),
      ADD COLUMN IF NOT EXISTS "extraction_source" varchar(32),
      ADD COLUMN IF NOT EXISTS "retrieval_mode" varchar(32)
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_knowledge_chunks"
      ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
    `);
    await queryRunner.query(`
      UPDATE "ai_knowledge_chunks"
      SET "content_tsv" = to_tsvector('portuguese', coalesce("title", '') || ' ' || coalesce("content", ''))
      WHERE "content_tsv" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_knowledge_chunks_content_tsv"
      ON "ai_knowledge_chunks"
      USING GIN ("content_tsv")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_knowledge_chunks_content_tsv"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_knowledge_chunks" DROP COLUMN IF EXISTS "content_tsv"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_token_usage_logs"
        DROP COLUMN IF EXISTS "retrieval_mode",
        DROP COLUMN IF EXISTS "extraction_source",
        DROP COLUMN IF EXISTS "draft_type",
        DROP COLUMN IF EXISTS "planner_intent",
        DROP COLUMN IF EXISTS "tools_invoked",
        DROP COLUMN IF EXISTS "tier"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_doc_cache_fingerprint"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_doc_cache"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_persistent_memory_user_scope"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_persistent_memory_user_scope_key"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_persistent_memories"`);
  }
}
