import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurposeToRecoveryCodes1755802100000 implements MigrationInterface {
  name = 'AddPurposeToRecoveryCodes1755802100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ADD COLUMN IF NOT EXISTS "purpose" character varying(32) NOT NULL DEFAULT 'password_reset'`,
    );
    await queryRunner.query(
      `UPDATE "recovery_codes" rc
          SET "purpose" = 'invite'
         FROM "users" u
        WHERE u."id" = rc."user_id"
          AND u."status" = 'pending'
          AND rc."reset_token" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" DROP COLUMN IF EXISTS "purpose"`,
    );
  }
}
