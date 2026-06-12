import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona `reset_token` + `reset_token_expires_at` em `recovery_codes`.
 *
 * O reset token de uso único é emitido na validação do código e exigido na
 * troca de senha, amarrando as duas etapas (Fase 5 do hardening de auth).
 */
export class AddResetTokenToRecoveryCodes1781229400000 implements MigrationInterface {
  name = 'AddResetTokenToRecoveryCodes1781229400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ADD COLUMN "reset_token" VARCHAR(255);`,
    );
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ADD COLUMN "reset_token_expires_at" TIMESTAMP;`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_recovery_codes_reset_token" ON "recovery_codes" ("reset_token") WHERE "reset_token" IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_recovery_codes_reset_token";`,
    );
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" DROP COLUMN "reset_token_expires_at";`,
    );
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" DROP COLUMN "reset_token";`,
    );
  }
}
