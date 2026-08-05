import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marcador de paciente cirúrgico na ficha de atendimento e o vínculo com a SC
 * gerada ao finalizar.
 *
 * `surgery_request_id` não é só um link de conveniência: a combinação
 * "finalizada + com indicação + sem SC" é o outbox que o sweeper do
 * `SurgicalIndicationService` varre, e é o que impede a criação em duplicidade.
 * Daí o índice parcial — a varredura precisa ser barata mesmo com a tabela
 * grande, já que a esmagadora maioria das fichas nunca entra nessa condição.
 */
export class AddSurgicalIndicationToClinicalRecords1752300500000 implements MigrationInterface {
  name = 'AddSurgicalIndicationToClinicalRecords1752300500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clinical_records" ADD COLUMN "surgical_indication" boolean NOT NULL DEFAULT false;`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_records" ADD COLUMN "surgery_request_id" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_records" ADD CONSTRAINT "fk_clinical_records_surgery_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id") ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_records_indication_pending" ON "clinical_records" ("finalized_at") WHERE surgical_indication = true AND surgery_request_id IS NULL AND finalized_at IS NOT NULL AND deleted_at IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_clinical_records_indication_pending";`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_records" DROP CONSTRAINT "fk_clinical_records_surgery_request";`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_records" DROP COLUMN "surgery_request_id";`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_records" DROP COLUMN "surgical_indication";`,
    );
  }
}
