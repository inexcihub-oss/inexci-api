import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Configuração de avisos automáticos ao paciente, por conta (registro do
 * dono). Coluna nula = tudo ligado, que é o comportamento anterior — não
 * precisa de backfill nem de preflight (não aperta o schema).
 */
export class AddPatientNotificationSettingsToUsers1755801600000 implements MigrationInterface {
  name = 'AddPatientNotificationSettingsToUsers1755801600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "patient_notification_settings" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "patient_notification_settings"`,
    );
  }
}
