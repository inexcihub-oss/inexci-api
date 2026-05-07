import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiPiiRedactionLog1762531200000 implements MigrationInterface {
  name = 'CreateAiPiiRedactionLog1762531200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_pii_redaction_log" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" UUID,
        "message_sid" character varying(64),
        "category" character varying(40) NOT NULL,
        "value_hash" character varying(64) NOT NULL,
        "blocked" boolean NOT NULL DEFAULT false,
        "tool_name" character varying(100),
        "occurrences" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_pii_redaction_log" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_pii_log_category_created"
      ON "ai_pii_redaction_log" ("category", "created_at" DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_pii_log_conversation"
      ON "ai_pii_redaction_log" ("conversation_id");
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "ai_pii_redaction_log"
        ADD CONSTRAINT "FK_ai_pii_log_conversation"
        FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_pii_redaction_log"
      DROP CONSTRAINT IF EXISTS "FK_ai_pii_log_conversation";
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_pii_log_conversation";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_pii_log_category_created";`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "ai_pii_redaction_log";`);
  }
}
