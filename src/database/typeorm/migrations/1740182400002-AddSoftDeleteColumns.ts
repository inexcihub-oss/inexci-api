import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteColumns1740182400002 implements MigrationInterface {
  name = 'AddSoftDeleteColumns1740182400002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patient" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "hospital" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_plan" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP`,
    );

    // Indexes para performance nas queries que filtram deleted_at IS NULL
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_patient_deleted_at" ON "patient" ("deleted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_hospital_deleted_at" ON "hospital" ("deleted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_supplier_deleted_at" ON "supplier" ("deleted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_health_plan_deleted_at" ON "health_plan" ("deleted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_user_deleted_at" ON "user" ("deleted_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_deleted_at"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_health_plan_deleted_at"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_supplier_deleted_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_hospital_deleted_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_patient_deleted_at"`);

    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "health_plan" DROP COLUMN IF EXISTS "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier" DROP COLUMN IF EXISTS "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hospital" DROP COLUMN IF EXISTS "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient" DROP COLUMN IF EXISTS "deleted_at"`,
    );
  }
}
