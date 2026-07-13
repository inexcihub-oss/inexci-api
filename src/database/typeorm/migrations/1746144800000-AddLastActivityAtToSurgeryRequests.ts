import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Coluna materializada `last_activity_at` + índice composto para ordenação
 * indexável da listagem (item 5.2 / P15).
 *
 * A coluna é mantida por trigger BEFORE INSERT OR UPDATE porque fluxos de
 * domínio usam `repo.update()`, que ignora hooks `@BeforeUpdate`.
 */
export class AddLastActivityAtToSurgeryRequests1746144800000 implements MigrationInterface {
  name = 'AddLastActivityAtToSurgeryRequests1746144800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
      ADD COLUMN "last_activity_at" TIMESTAMPTZ;
    `);

    await queryRunner.query(`
      UPDATE "surgery_requests"
      SET "last_activity_at" = GREATEST(
        COALESCE("last_status_changed_at", "created_at"),
        "updated_at"
      );
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION surgery_requests_set_last_activity_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.last_activity_at := GREATEST(
          COALESCE(NEW.last_status_changed_at, NEW.created_at),
          NEW.updated_at
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_surgery_requests_last_activity_at
      BEFORE INSERT OR UPDATE ON "surgery_requests"
      FOR EACH ROW
      EXECUTE FUNCTION surgery_requests_set_last_activity_at();
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_sr_doctor_last_activity"
      ON "surgery_requests" ("doctor_id", "last_activity_at" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_surgery_requests_last_activity_at ON "surgery_requests";`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS surgery_requests_set_last_activity_at();`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_sr_doctor_last_activity";`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_requests" DROP COLUMN IF EXISTS "last_activity_at";`,
    );
  }
}
