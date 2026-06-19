import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceNotesToSurgeryRequestBillings1781821000000 implements MigrationInterface {
  name = 'AddInvoiceNotesToSurgeryRequestBillings1781821000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request_billings"
      ADD COLUMN IF NOT EXISTS "invoice_notes" TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request_billings"
      DROP COLUMN IF EXISTS "invoice_notes";
    `);
  }
}
