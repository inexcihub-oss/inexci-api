import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige divergências entre entities e migration consolidada:
 *
 * 1. Adiciona "usage_count" na tabela surgery_request_template
 *    (campo presente na entity mas ausente na migration anterior).
 */
export class FixMissingFields1745100000000 implements MigrationInterface {
  name = 'FixMissingFields1745100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------ //
    // 1. Adiciona usage_count em surgery_request_template
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      ALTER TABLE "surgery_request_template"
        ADD COLUMN IF NOT EXISTS "usage_count" integer NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request_template"
        DROP COLUMN IF EXISTS "usage_count";
    `);
  }
}
