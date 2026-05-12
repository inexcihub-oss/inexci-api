import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp / IA — conversação, RAG, tokens e PII.
 *
 * Tabelas:
 *  - whatsapp_conversations
 *  - whatsapp_conversation_messages
 *  - ai_knowledge_chunks (RAG, requer extensão `vector`)
 *  - ai_token_usage_logs
 *  - ai_pii_redaction_logs
 *  - conversation_cleanup_log
 *
 * Histórico bruto vive em `whatsapp_conversation_messages` (1 linha por
 * mensagem) — sem coluna JSONB monolítica `messages_history` para reduzir I/O.
 */
export class CreateWhatsappAndAi1746144600000 implements MigrationInterface {
  name = 'CreateWhatsappAndAi1746144600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "whatsapp_conversations" (
        "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
        "phone"                VARCHAR(20) NOT NULL,
        "user_id"              UUID,
        "owner_id"             UUID,
        "conversation_summary" TEXT,
        "conversation_memory"  JSONB NOT NULL DEFAULT '{}'::jsonb,
        "summary_updated_at"   TIMESTAMPTZ,
        "summary_version"      INTEGER NOT NULL DEFAULT 1,
        "started_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_message_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "active"               BOOLEAN NOT NULL DEFAULT true,
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_whatsapp_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_wc_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_wc_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_wc_phone"       ON "whatsapp_conversations" ("phone");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wc_active"      ON "whatsapp_conversations" ("active", "last_message_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wc_owner"       ON "whatsapp_conversations" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wc_phone_active"
         ON "whatsapp_conversations" ("phone")
         WHERE "active" = true;`,
    );

    await queryRunner.query(`
      CREATE TABLE "whatsapp_conversation_messages" (
        "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" UUID NOT NULL,
        "role"            VARCHAR(20) NOT NULL,
        "content"         TEXT NOT NULL,
        "tool_name"       VARCHAR(100),
        "metadata"        JSONB,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_whatsapp_conversation_messages" PRIMARY KEY ("id"),
        CONSTRAINT "fk_wcm_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_wcm_conversation_created" ON "whatsapp_conversation_messages" ("conversation_id", "created_at");`,
    );

    await queryRunner.query(`
      CREATE TABLE "ai_knowledge_chunks" (
        "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
        "category"   VARCHAR(50) NOT NULL,
        "title"      TEXT NOT NULL,
        "content"    TEXT NOT NULL,
        "metadata"   JSONB,
        "embedding"  extensions.vector(1536),
        "active"     BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_knowledge_chunks" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_knowledge_category_active" ON "ai_knowledge_chunks" ("category", "active");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_knowledge_embedding"
         ON "ai_knowledge_chunks"
         USING hnsw ("embedding" vector_cosine_ops)
         WITH (lists = 100);`,
    );

    await queryRunner.query(`
      CREATE TABLE "ai_token_usage_logs" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "message_sid"         VARCHAR(64) NOT NULL,
        "phone_hash"          VARCHAR(64) NOT NULL,
        "user_id"             UUID,
        "conversation_id"     UUID,
        "owner_id"            UUID,
        "prompt_tokens"       INTEGER NOT NULL DEFAULT 0,
        "completion_tokens"   INTEGER NOT NULL DEFAULT 0,
        "total_tokens"        INTEGER NOT NULL DEFAULT 0,
        "calls_count"         INTEGER NOT NULL DEFAULT 0,
        "model"               VARCHAR(50),
        "latency_ms"          INTEGER,
        "cost_estimate_cents" INTEGER,
        "breakdown"           JSONB NOT NULL DEFAULT '[]'::jsonb,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_token_usage_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_token_logs_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_ai_token_logs_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_ai_token_logs_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_message_sid"             ON "ai_token_usage_logs" ("message_sid");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_conversation_created_at" ON "ai_token_usage_logs" ("conversation_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_user_created_at"         ON "ai_token_usage_logs" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_created_at"              ON "ai_token_usage_logs" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_owner"                   ON "ai_token_usage_logs" ("owner_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "ai_pii_redaction_logs" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" UUID,
        "message_sid"     VARCHAR(64),
        "category"        VARCHAR(40) NOT NULL,
        "value_hash"      VARCHAR(64) NOT NULL,
        "blocked"         BOOLEAN NOT NULL DEFAULT false,
        "tool_name"       VARCHAR(100),
        "occurrences"     INTEGER NOT NULL DEFAULT 1,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_pii_redaction_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_pii_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ai_pii_category_created" ON "ai_pii_redaction_logs" ("category", "created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_pii_conversation"     ON "ai_pii_redaction_logs" ("conversation_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "conversation_cleanup_log" (
        "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
        "deleted_count" INTEGER NOT NULL DEFAULT 0,
        "cutoff_date"   TIMESTAMPTZ NOT NULL,
        "executed_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_conversation_cleanup_log" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_cleanup_log_executed" ON "conversation_cleanup_log" ("executed_at" DESC);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'conversation_cleanup_log',
      'ai_pii_redaction_logs',
      'ai_token_usage_logs',
      'ai_knowledge_chunks',
      'whatsapp_conversation_messages',
      'whatsapp_conversations',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }
  }
}
