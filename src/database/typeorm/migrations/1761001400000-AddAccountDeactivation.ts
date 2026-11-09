import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountDeactivation1761001400000 implements MigrationInterface {
  name = 'AddAccountDeactivation1761001400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "account_deactivated_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "account_deactivated_by_id" uuid
         CONSTRAINT "FK_users_account_deactivated_by"
         REFERENCES "platform_admins"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_account_deactivated_by_id" ON "users" ("account_deactivated_by_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_account_deactivated_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "account_deactivated_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "account_deactivated_at"`,
    );
  }
}
