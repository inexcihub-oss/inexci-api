import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove a coluna `email_notifications` de `user_notification_settings`.
 *
 * Política nova de notificações para usuários do sistema:
 *  - Atualizações de status: somente in-app (push) + WhatsApp.
 *  - Único e-mail enviado: o resumo semanal, controlado por `weekly_report`.
 *
 * O canal de e-mail genérico para notificações de plataforma deixa de existir.
 */
export class RemoveEmailNotificationsChannel1746748800000 implements MigrationInterface {
  name = 'RemoveEmailNotificationsChannel1746748800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_settings"
        DROP COLUMN IF EXISTS "email_notifications";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_settings"
        ADD COLUMN IF NOT EXISTS "email_notifications" BOOLEAN NOT NULL DEFAULT true;
    `);
  }
}
