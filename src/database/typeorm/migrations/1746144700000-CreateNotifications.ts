import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notificações in-app, preferências por usuário e log unificado de envio.
 *
 * Política de notificações:
 *  - Atualizações de status: somente in-app (push) + WhatsApp.
 *  - Único e-mail enviado: o resumo semanal (`weekly_report`).
 *
 * `notification_send_logs` é a tabela única de auditoria de envio (e-mail
 * + WhatsApp). Depende de `whatsapp_conversations`, por isso esta migration
 * roda após `CreateWhatsappAndAi`. `body` e `error_message` são limitados em
 * VARCHAR(600) — truncagem é aplicada na escrita por `truncateForLog`.
 */
export class CreateNotifications1746144700000 implements MigrationInterface {
  name = 'CreateNotifications1746144700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "type"       "notification_type_enum" NOT NULL DEFAULT 'info',
        "title"      VARCHAR(255) NOT NULL,
        "message"    TEXT NOT NULL,
        "read"       BOOLEAN NOT NULL DEFAULT false,
        "link"       VARCHAR(255),
        "metadata"   JSONB,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "fk_notifications_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_user_read" ON "notifications" ("user_id", "read");`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_notification_settings" (
        "id"                     UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"                UUID NOT NULL,
        "push_notifications"     BOOLEAN NOT NULL DEFAULT true,
        "whatsapp_notifications" BOOLEAN NOT NULL DEFAULT true,
        "new_surgery_request"    BOOLEAN NOT NULL DEFAULT true,
        "status_update"          BOOLEAN NOT NULL DEFAULT true,
        "pendencies"             BOOLEAN NOT NULL DEFAULT true,
        "expiring_documents"     BOOLEAN NOT NULL DEFAULT true,
        "weekly_report"          BOOLEAN NOT NULL DEFAULT false,
        "created_at"             TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"             TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_notification_settings" PRIMARY KEY ("id"),
        CONSTRAINT "uq_uns_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_uns_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "notification_send_logs" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "channel"           "notification_channel_enum" NOT NULL,
        "status"            "notification_send_status_enum" NOT NULL DEFAULT 'queued',
        "to"                VARCHAR(255) NOT NULL,
        "subject"           VARCHAR(255),
        "template"          VARCHAR(100),
        "body"              VARCHAR(600),
        "error_message"     VARCHAR(600),
        "job_id"            VARCHAR(100),
        "attempts"          INTEGER NOT NULL DEFAULT 0,
        "sent_at"           TIMESTAMPTZ,
        "message_sid"       VARCHAR(64),
        "user_id"           UUID,
        "conversation_id"   UUID,
        "owner_id"          UUID,
        "direction"         VARCHAR(10) DEFAULT 'outbound',
        "notification_type" VARCHAR(20) DEFAULT 'freeform',
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_send_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_nsl_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_nsl_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_nsl_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_channel_status" ON "notification_send_logs" ("channel", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_created_at"     ON "notification_send_logs" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_owner"          ON "notification_send_logs" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_owner_created"  ON "notification_send_logs" ("owner_id", "created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_message_sid"    ON "notification_send_logs" ("message_sid");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'notification_send_logs',
      'user_notification_settings',
      'notifications',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }
  }
}
