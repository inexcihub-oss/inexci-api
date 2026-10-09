import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  OUTRO_NAO_UNIFICADO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class AddGenericSupplierAndManufacturer1755700200000 implements MigrationInterface {
  name = 'AddGenericSupplierAndManufacturer1755700200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const naoUnificados = await verificar(OUTRO_NAO_UNIFICADO, (sql) =>
      queryRunner.query(sql),
    );
    if (naoUnificados.length > 0) {
      throw new Error(montarDiagnostico(OUTRO_NAO_UNIFICADO, naoUnificados));
    }

    await queryRunner.query(
      `ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_generic" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "is_generic" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_suppliers_owner_generic"
         ON "suppliers" ("owner_id")
      WHERE "is_generic" AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_manufacturers_owner_generic"
         ON "manufacturers" ("owner_id")
      WHERE "is_generic" AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_manufacturers_owner_generic"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_suppliers_owner_generic"`,
    );
    await queryRunner.query(
      `ALTER TABLE "manufacturers" DROP COLUMN IF EXISTS "is_generic"`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "is_generic"`,
    );
  }
}
