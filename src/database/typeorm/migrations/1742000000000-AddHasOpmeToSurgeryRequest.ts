import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona a coluna `has_opme` (boolean nullable) à tabela surgery_request.
 * null  = não informado ainda (pendência aberta)
 * true  = utiliza OPME (itens devem ser cadastrados)
 * false = não utiliza OPME (pendência dispensada)
 */
export class AddHasOpmeToSurgeryRequest1742000000000 implements MigrationInterface {
  name = 'AddHasOpmeToSurgeryRequest1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD COLUMN IF NOT EXISTS "has_opme" boolean NULL DEFAULT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      DROP COLUMN IF EXISTS "has_opme";
    `);
  }
}
