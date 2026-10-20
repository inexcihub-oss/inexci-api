import { MigrationInterface, QueryRunner } from 'typeorm';

export const TABELA_LEGADA_DE_AVISOS = 'patient_notification_settings';

export class MovePatientNotificationSettingsToUsers1755802500000 implements MigrationInterface {
  name = 'MovePatientNotificationSettingsToUsers1755802500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABELA_LEGADA_DE_AVISOS))) return;

    await queryRunner.query(
      `UPDATE "users" u
          SET "patient_notification_settings" =
                COALESCE(u."patient_notification_settings", '{}'::jsonb)
                || jsonb_build_object(
                     'appointmentScheduled', p."appointment_scheduled",
                     'appointmentReminder', p."appointment_reminder",
                     'appointmentCancelled', p."appointment_cancelled"
                   )
         FROM "${TABELA_LEGADA_DE_AVISOS}" p
        WHERE u."id" = p."owner_id"`,
    );
    await queryRunner.query(`DROP TABLE "${TABELA_LEGADA_DE_AVISOS}"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "${TABELA_LEGADA_DE_AVISOS}" (
         "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "appointment_scheduled" boolean NOT NULL DEFAULT true,
         "appointment_reminder" boolean NOT NULL DEFAULT true,
         "appointment_cancelled" boolean NOT NULL DEFAULT true,
         "created_at" TIMESTAMP NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_patient_notification_settings" PRIMARY KEY ("owner_id")
       )`,
    );
    await queryRunner.query(
      `INSERT INTO "${TABELA_LEGADA_DE_AVISOS}"
              ("owner_id", "appointment_scheduled", "appointment_reminder", "appointment_cancelled")
       SELECT u."id",
              COALESCE((u."patient_notification_settings"->>'appointmentScheduled')::boolean, true),
              COALESCE((u."patient_notification_settings"->>'appointmentReminder')::boolean, true),
              COALESCE((u."patient_notification_settings"->>'appointmentCancelled')::boolean, true)
         FROM "users" u
        WHERE u."patient_notification_settings" IS NOT NULL
       ON CONFLICT ("owner_id") DO NOTHING`,
    );
  }
}
