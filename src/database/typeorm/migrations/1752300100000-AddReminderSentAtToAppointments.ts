import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona `reminder_sent_at` a `appointments` — marca de idempotência do
 * lembrete automático de consulta (Fase 2 do módulo de atendimento).
 */
export class AddReminderSentAtToAppointments1752300100000 implements MigrationInterface {
  name = 'AddReminderSentAtToAppointments1752300100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN "reminder_sent_at" timestamptz;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "reminder_sent_at";`,
    );
  }
}
