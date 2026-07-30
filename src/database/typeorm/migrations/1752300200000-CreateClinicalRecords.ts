import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela `clinical_records` (prontuário / ficha de atendimento) — Fase 3
 * do módulo de atendimento. Escopada por clínica (owner_id) e paciente.
 */
export class CreateClinicalRecords1752300200000 implements MigrationInterface {
  name = 'CreateClinicalRecords1752300200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "clinical_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "doctor_id" uuid NOT NULL,
        "owner_id" uuid NOT NULL,
        "patient_id" uuid NOT NULL,
        "appointment_id" uuid,
        "anamnesis" text,
        "physical_exam" text,
        "diagnosis" text,
        "cid_codes" jsonb,
        "conduct" text,
        "finalized_at" timestamptz,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_clinical_records" PRIMARY KEY ("id"),
        CONSTRAINT "FK_clinical_records_doctor" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_clinical_records_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_clinical_records_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_clinical_records_appointment" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_clinical_records_owner_id" ON "clinical_records" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_records_patient_id" ON "clinical_records" ("patient_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_records_appointment_id" ON "clinical_records" ("appointment_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clinical_records";`);
  }
}
