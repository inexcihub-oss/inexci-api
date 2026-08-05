import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela `clinical_record_templates` (modelos de anamnese) — Fase 4 do
 * módulo de atendimento. Mesmos campos clínicos da ficha, escopados por
 * clínica (`owner_id`) e médico (`doctor_id`).
 */
export class CreateClinicalRecordTemplates1752300600000 implements MigrationInterface {
  name = 'CreateClinicalRecordTemplates1752300600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "clinical_record_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "doctor_id" uuid NOT NULL,
        "name" character varying(100) NOT NULL,
        "specialty" character varying(100),
        "anamnesis" text,
        "physical_exam" text,
        "diagnosis" text,
        "conduct" text,
        "cid_codes" jsonb,
        "usage_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_clinical_record_templates" PRIMARY KEY ("id"),
        CONSTRAINT "FK_clinical_record_templates_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_clinical_record_templates_doctor" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_crt_owner_id" ON "clinical_record_templates" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_crt_doctor_id" ON "clinical_record_templates" ("doctor_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clinical_record_templates";`);
  }
}
