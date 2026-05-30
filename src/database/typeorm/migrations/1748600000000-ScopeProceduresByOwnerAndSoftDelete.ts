import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Torna procedimentos tenant-aware:
 * - adiciona owner_id e deleted_at
 * - define fk de owner para users
 */
export class ScopeProceduresByOwnerAndSoftDelete1748600000000 implements MigrationInterface {
  name = 'ScopeProceduresByOwnerAndSoftDelete1748600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "procedures"
      ADD COLUMN IF NOT EXISTS "owner_id" UUID,
      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_procedures_owner_id" ON "procedures" ("owner_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_procedures_deleted_at" ON "procedures" ("deleted_at");
    `);

    await queryRunner.query(`
      ALTER TABLE "procedures"
      ALTER COLUMN "owner_id" SET NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "procedures"
      ADD CONSTRAINT "fk_procedures_owner"
      FOREIGN KEY ("owner_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "procedures" DROP CONSTRAINT IF EXISTS "fk_procedures_owner";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_procedures_owner_id";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_procedures_deleted_at";
    `);
    await queryRunner.query(`
      ALTER TABLE "procedures"
      DROP COLUMN IF EXISTS "owner_id",
      DROP COLUMN IF EXISTS "deleted_at";
    `);
  }
}
