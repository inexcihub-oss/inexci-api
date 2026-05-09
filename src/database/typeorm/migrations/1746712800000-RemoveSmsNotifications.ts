import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove a coluna `sms_notifications` de `user_notification_settings`.
 * O canal de SMS não é suportado pela plataforma — usamos apenas e-mail,
 * push (in-app + WebSocket) e WhatsApp.
 */
export class RemoveSmsNotifications1746712800000 implements MigrationInterface {
  name = 'RemoveSmsNotifications1746712800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_settings"
        DROP COLUMN IF EXISTS "sms_notifications";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_settings"
        ADD COLUMN IF NOT EXISTS "sms_notifications" BOOLEAN NOT NULL DEFAULT false;
    `);
  }
}
