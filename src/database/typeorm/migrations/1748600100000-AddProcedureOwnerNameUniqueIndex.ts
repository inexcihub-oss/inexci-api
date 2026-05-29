import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Impede duplicidade de procedimentos por clínica (owner),
 * considerando apenas registros ativos (não soft-deletados).
 */
export class AddProcedureOwnerNameUniqueIndex1748600100000 implements MigrationInterface {
  name = 'AddProcedureOwnerNameUniqueIndex1748600100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_procedures_owner_name_active"
      ON "procedures" ("owner_id", LOWER("name"))
      WHERE "deleted_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_procedures_owner_name_active";
    `);
  }
}
