import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Avisos automáticos ao paciente, ligados ou desligados por conta. Tabela
 * nova, sem dado legado para conferir: conta sem linha continua com tudo
 * ligado, como era antes.
 */
export class CreatePatientNotificationSettings1755801200000 implements MigrationInterface {
  name = 'CreatePatientNotificationSettings1755801200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "patient_notification_settings" (
         "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "appointment_scheduled" boolean NOT NULL DEFAULT true,
         "appointment_reminder" boolean NOT NULL DEFAULT true,
         "appointment_cancelled" boolean NOT NULL DEFAULT true,
         "created_at" TIMESTAMP NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_patient_notification_settings" PRIMARY KEY ("owner_id")
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "patient_notification_settings"`);
  }
}
