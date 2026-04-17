import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequiredDocumentsToSurgeryRequest1745000200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD COLUMN IF NOT EXISTS "required_documents" jsonb NULL DEFAULT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      DROP COLUMN IF EXISTS "required_documents";
    `);
  }
}
