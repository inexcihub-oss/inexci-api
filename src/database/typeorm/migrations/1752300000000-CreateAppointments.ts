import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela `appointments` (consultas/retornos) — base do módulo de
 * atendimento (Fase 1). Escopada por clínica (owner_id) e médico (doctor_id).
 */
export class CreateAppointments1752300000000 implements MigrationInterface {
  name = 'CreateAppointments1752300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "appointments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "doctor_id" uuid NOT NULL,
        "owner_id" uuid NOT NULL,
        "patient_id" uuid NOT NULL,
        "type" varchar(20) NOT NULL DEFAULT 'first_visit',
        "status" varchar(20) NOT NULL DEFAULT 'scheduled',
        "scheduled_at" timestamptz NOT NULL,
        "duration_minutes" integer NOT NULL DEFAULT 30,
        "notes" text,
        "cancellation_reason" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_appointments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_appointments_doctor" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_appointments_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_appointments_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_appointments_owner_id" ON "appointments" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_doctor_id" ON "appointments" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_patient_id" ON "appointments" ("patient_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_scheduled_at" ON "appointments" ("scheduled_at");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "appointments";`);
  }
}
