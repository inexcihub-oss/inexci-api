import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase2ObservabilityAndCost1762790400000 implements MigrationInterface {
  name = 'Phase2ObservabilityAndCost1762790400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // T9: model, latency_ms, cost_estimate_cents em ai_token_usage_log
    await queryRunner.query(`
      ALTER TABLE ai_token_usage_log
        ADD COLUMN IF NOT EXISTS model VARCHAR(50),
        ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
        ADD COLUMN IF NOT EXISTS cost_estimate_cents INTEGER;
    `);

    // T11: Enriquecer whatsapp_message_log
    await queryRunner.query(`
      ALTER TABLE whatsapp_message_log
        ADD COLUMN IF NOT EXISTS message_sid VARCHAR(64),
        ADD COLUMN IF NOT EXISTS user_id UUID,
        ADD COLUMN IF NOT EXISTS conversation_id UUID,
        ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
        ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'freeform';
    `);

    // FKs para novos campos
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE whatsapp_message_log
          ADD CONSTRAINT "FK_whatsapp_message_log_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE whatsapp_message_log
          ADD CONSTRAINT "FK_whatsapp_message_log_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Índices para whatsapp_message_log
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_wml_message_sid
        ON whatsapp_message_log (message_sid);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_wml_to_created
        ON whatsapp_message_log ("to", created_at DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_wml_status_created
        ON whatsapp_message_log (status, created_at DESC);
    `);

    // T12: Adicionar novos valores ao enum de status
    await queryRunner.query(`
      ALTER TYPE whatsapp_message_log_status_enum
        ADD VALUE IF NOT EXISTS 'queued';
    `);
    await queryRunner.query(`
      ALTER TYPE whatsapp_message_log_status_enum
        ADD VALUE IF NOT EXISTS 'delivered';
    `);
    await queryRunner.query(`
      ALTER TYPE whatsapp_message_log_status_enum
        ADD VALUE IF NOT EXISTS 'read';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Índices
    await queryRunner.query(`DROP INDEX IF EXISTS idx_wml_status_created;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_wml_to_created;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_wml_message_sid;`);

    // FKs
    await queryRunner.query(`
      ALTER TABLE whatsapp_message_log
        DROP CONSTRAINT IF EXISTS "FK_whatsapp_message_log_conversation";
    `);
    await queryRunner.query(`
      ALTER TABLE whatsapp_message_log
        DROP CONSTRAINT IF EXISTS "FK_whatsapp_message_log_user";
    `);

    // Colunas de whatsapp_message_log
    await queryRunner.query(`
      ALTER TABLE whatsapp_message_log
        DROP COLUMN IF EXISTS type,
        DROP COLUMN IF EXISTS direction,
        DROP COLUMN IF EXISTS conversation_id,
        DROP COLUMN IF EXISTS user_id,
        DROP COLUMN IF EXISTS message_sid;
    `);

    // Colunas de ai_token_usage_log
    await queryRunner.query(`
      ALTER TABLE ai_token_usage_log
        DROP COLUMN IF EXISTS cost_estimate_cents,
        DROP COLUMN IF EXISTS latency_ms,
        DROP COLUMN IF EXISTS model;
    `);

    // Nota: ADD VALUE em enum não é revertível em PostgreSQL sem recriar o tipo.
    // Valores extras do enum ficam como no-op se não usados.
  }
}
