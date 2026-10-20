import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMfaToUsers1755802410000 implements MigrationInterface {
  name = 'AddMfaToUsers1755802410000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users"
         ADD COLUMN IF NOT EXISTS "mfa_secret" text,
         ADD COLUMN IF NOT EXISTS "mfa_pending_secret" text,
         ADD COLUMN IF NOT EXISTS "mfa_enabled_at" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN IF NOT EXISTS "mfa_recovery_codes" text[],
         ADD COLUMN IF NOT EXISTS "mfa_last_used_step" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users"
         DROP COLUMN IF EXISTS "mfa_last_used_step",
         DROP COLUMN IF EXISTS "mfa_recovery_codes",
         DROP COLUMN IF EXISTS "mfa_enabled_at",
         DROP COLUMN IF EXISTS "mfa_pending_secret",
         DROP COLUMN IF EXISTS "mfa_secret"`,
    );
  }
}
