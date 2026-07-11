import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove colunas clínicas legadas substituídas por `report_sections` + `patients`.
 */
export class DropLegacyClinicalColumnsFromSurgeryRequests1746144900000
  implements MigrationInterface
{
  name = 'DropLegacyClinicalColumnsFromSurgeryRequests1746144900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
      DROP COLUMN IF EXISTS "diagnosis",
      DROP COLUMN IF EXISTS "medical_report",
      DROP COLUMN IF EXISTS "patient_history",
      DROP COLUMN IF EXISTS "surgery_description";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
      ADD COLUMN "diagnosis" TEXT,
      ADD COLUMN "medical_report" TEXT,
      ADD COLUMN "patient_history" TEXT,
      ADD COLUMN "surgery_description" TEXT;
    `);
  }
}
