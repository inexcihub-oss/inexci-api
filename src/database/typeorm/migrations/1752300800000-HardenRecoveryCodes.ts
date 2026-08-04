import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenRecoveryCodes1752300800000 implements MigrationInterface {
  name = 'HardenRecoveryCodes1752300800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Convite passa a usar UUID (36 chars); 64 deixa folga para formatos futuros.
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ALTER COLUMN "code" TYPE character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0`,
    );
    // Invalida convites/codigos emitidos antes do hardening.
    await queryRunner.query(
      `UPDATE "recovery_codes" SET "used" = true WHERE "used" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" DROP COLUMN IF EXISTS "attempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ALTER COLUMN "code" TYPE character varying(6)`,
    );
  }
}
