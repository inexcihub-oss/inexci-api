import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase7UnifyNotificationLog1763136000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Adicionar novas colunas em notification_send_log
    await queryRunner.query(`
      ALTER TABLE "notification_send_log"
        ADD COLUMN IF NOT EXISTS "body" text,
        ADD COLUMN IF NOT EXISTS "message_sid" varchar(64),
        ADD COLUMN IF NOT EXISTS "user_id" uuid,
        ADD COLUMN IF NOT EXISTS "conversation_id" uuid,
        ADD COLUMN IF NOT EXISTS "direction" varchar(10) DEFAULT 'outbound',
        ADD COLUMN IF NOT EXISTS "notification_type" varchar(20) DEFAULT 'freeform',
        ADD COLUMN IF NOT EXISTS "account_id" uuid
    `);

    // 2. Adicionar novos valores ao enum de status
    await queryRunner.query(`
      ALTER TYPE "notification_send_log_status_enum"
        ADD VALUE IF NOT EXISTS 'delivered'
    `);
    await queryRunner.query(`
      ALTER TYPE "notification_send_log_status_enum"
        ADD VALUE IF NOT EXISTS 'read'
    `);

    // 3. FKs opcionais
    await queryRunner.query(`
      ALTER TABLE "notification_send_log"
        ADD CONSTRAINT "fk_nsl_user"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_send_log"
        ADD CONSTRAINT "fk_nsl_conversation"
        FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id") ON DELETE SET NULL
    `);

    // 4. Índices
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_nsl_account" ON "notification_send_log" ("account_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_nsl_message_sid" ON "notification_send_log" ("message_sid")
    `);

    // 5. Migrar dados residuais de whatsapp_message_log → notification_send_log
    await queryRunner.query(`
      INSERT INTO "notification_send_log" (
        "channel", "status", "to", "body", "template", "error_message",
        "sent_at", "message_sid", "user_id", "conversation_id",
        "direction", "notification_type", "account_id", "created_at"
      )
      SELECT
        'whatsapp',
        CASE wml.status
          WHEN 'sent' THEN 'sent'
          WHEN 'failed' THEN 'failed'
          WHEN 'queued' THEN 'queued'
          WHEN 'delivered' THEN 'delivered'
          WHEN 'read' THEN 'read'
          ELSE 'queued'
        END::notification_send_log_status_enum,
        wml.to,
        wml.body,
        NULL,
        wml.error_message,
        wml.sent_at,
        wml.message_sid,
        wml.user_id,
        wml.conversation_id,
        wml.direction,
        wml.type,
        wml.account_id,
        wml.created_at
      FROM "whatsapp_message_log" wml
      WHERE NOT EXISTS (
        SELECT 1 FROM "notification_send_log" nsl
        WHERE nsl."channel" = 'whatsapp'
          AND nsl."to" = wml."to"
          AND nsl."created_at" = wml."created_at"
      )
    `);

    // 6. Deprecar tabela antiga (renomear para indicar depreciação)
    await queryRunner.query(`
      ALTER TABLE "whatsapp_message_log"
        RENAME TO "whatsapp_message_log_deprecated"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaurar tabela original
    await queryRunner.query(`
      ALTER TABLE "whatsapp_message_log_deprecated"
        RENAME TO "whatsapp_message_log"
    `);

    // Remover dados migrados (registros com channel = 'whatsapp' originados do whatsapp_message_log)
    // Nota: impossível distinguir perfeitamente — apenas remove os índices e colunas

    // Remover FKs
    await queryRunner.query(`
      ALTER TABLE "notification_send_log"
        DROP CONSTRAINT IF EXISTS "fk_nsl_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_send_log"
        DROP CONSTRAINT IF EXISTS "fk_nsl_conversation"
    `);

    // Remover índices
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_nsl_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_nsl_message_sid"`);

    // Remover colunas adicionadas
    await queryRunner.query(`
      ALTER TABLE "notification_send_log"
        DROP COLUMN IF EXISTS "body",
        DROP COLUMN IF EXISTS "message_sid",
        DROP COLUMN IF EXISTS "user_id",
        DROP COLUMN IF EXISTS "conversation_id",
        DROP COLUMN IF EXISTS "direction",
        DROP COLUMN IF EXISTS "notification_type",
        DROP COLUMN IF EXISTS "account_id"
    `);
  }
}
