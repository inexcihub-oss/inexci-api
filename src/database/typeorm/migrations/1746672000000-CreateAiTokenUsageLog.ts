import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiTokenUsageLog1746672000000 implements MigrationInterface {
  name = 'CreateAiTokenUsageLog1746672000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_token_usage_log" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "message_sid" character varying(64) NOT NULL,
        "phone" character varying(20) NOT NULL,
        "user_id" UUID,
        "conversation_id" UUID,
        "prompt_tokens" integer NOT NULL DEFAULT 0,
        "completion_tokens" integer NOT NULL DEFAULT 0,
        "total_tokens" integer NOT NULL DEFAULT 0,
        "calls_count" integer NOT NULL DEFAULT 0,
        "breakdown" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_token_usage_log" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_message_sid"
      ON "ai_token_usage_log" ("message_sid");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_conversation_created_at"
      ON "ai_token_usage_log" ("conversation_id", "created_at");
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "ai_token_usage_log"
        ADD CONSTRAINT "FK_ai_token_usage_log_user"
        FOREIGN KEY ("user_id") REFERENCES "user"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "ai_token_usage_log"
        ADD CONSTRAINT "FK_ai_token_usage_log_conversation"
        FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_token_usage_log"
      DROP CONSTRAINT IF EXISTS "FK_ai_token_usage_log_conversation";
    `);

    await queryRunner.query(`
      ALTER TABLE "ai_token_usage_log"
      DROP CONSTRAINT IF EXISTS "FK_ai_token_usage_log_user";
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_token_usage_conversation_created_at";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_token_usage_message_sid";`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "ai_token_usage_log";`);
  }
}
