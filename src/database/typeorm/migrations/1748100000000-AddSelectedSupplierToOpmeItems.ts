import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSelectedSupplierToOpmeItems1748100000000 implements MigrationInterface {
  name = 'AddSelectedSupplierToOpmeItems1748100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "opme_items"
      ADD COLUMN IF NOT EXISTS "selected_supplier_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "opme_items"
      ADD CONSTRAINT "fk_opme_items_selected_supplier"
      FOREIGN KEY ("selected_supplier_id")
      REFERENCES "suppliers"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_opme_items_selected_supplier_id"
      ON "opme_items" ("selected_supplier_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_opme_items_selected_supplier_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "opme_items"
      DROP CONSTRAINT IF EXISTS "fk_opme_items_selected_supplier"
    `);

    await queryRunner.query(`
      ALTER TABLE "opme_items"
      DROP COLUMN IF EXISTS "selected_supplier_id"
    `);
  }
}
