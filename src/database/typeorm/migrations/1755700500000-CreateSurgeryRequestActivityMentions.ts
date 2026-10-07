import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Menções (@) em comentários da solicitação cirúrgica.
 *
 * Todas as constraints vão inline no `CREATE TABLE`, e não como
 * `ADD CONSTRAINT`: a tabela nasce aqui, não existe dado legado que possa
 * violá-las e, por isso, não há o que verificar em
 * `preflight/data-checks.ts` (ver `migrations-restritivas.spec.ts`).
 *
 * A unicidade (activity_id, mentioned_user_id) é o que impede o mesmo
 * usuário receber duas notificações porque foi citado duas vezes no mesmo
 * comentário.
 */
export class CreateSurgeryRequestActivityMentions1755700500000 implements MigrationInterface {
  name = 'CreateSurgeryRequestActivityMentions1755700500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "surgery_request_activity_mentions" (
        "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
        "activity_id"       UUID NOT NULL,
        "mentioned_user_id" UUID NOT NULL,
        "notification_id"   UUID,
        "email_sent_at"     TIMESTAMPTZ,
        "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_activity_mentions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_sram_activity_user" UNIQUE ("activity_id", "mentioned_user_id"),
        CONSTRAINT "fk_sram_activity"
          FOREIGN KEY ("activity_id") REFERENCES "surgery_request_activities"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_sram_user"
          FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_sram_notification"
          FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_sram_activity" ON "surgery_request_activity_mentions" ("activity_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sram_mentioned_user" ON "surgery_request_activity_mentions" ("mentioned_user_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_activity_mentions";`,
    );
  }
}
