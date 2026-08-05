import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permite anexar documentos (exames/anexos) ao paciente e à ficha de
 * atendimento, além da solicitação cirúrgica. `surgery_request_id` deixa de
 * ser obrigatório; ganham `patient_id` e `clinical_record_id` (ambos nullable).
 */
export class AddPatientAndClinicalRecordToDocuments1752300300000 implements MigrationInterface {
  name = 'AddPatientAndClinicalRecordToDocuments1752300300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ALTER COLUMN "surgery_request_id" DROP NOT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "patient_id" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "clinical_record_id" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_documents_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE;`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_documents_clinical_record" FOREIGN KEY ("clinical_record_id") REFERENCES "clinical_records"("id") ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_documents_patient_id" ON "documents" ("patient_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_documents_clinical_record_id" ON "documents" ("clinical_record_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_documents_clinical_record_id";`);
    await queryRunner.query(`DROP INDEX "idx_documents_patient_id";`);
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_documents_clinical_record";`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_documents_patient";`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "clinical_record_id";`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "patient_id";`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ALTER COLUMN "surgery_request_id" SET NOT NULL;`,
    );
  }
}
