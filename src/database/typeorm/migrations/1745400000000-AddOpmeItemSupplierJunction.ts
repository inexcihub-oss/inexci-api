import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpmeItemSupplierJunction1745400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "opme_item_supplier" (
        "opme_item_id" uuid NOT NULL,
        "supplier_id"  uuid NOT NULL,
        PRIMARY KEY ("opme_item_id", "supplier_id"),
        CONSTRAINT "fk_opme_item_supplier_opme_item"
          FOREIGN KEY ("opme_item_id")
          REFERENCES "opme_item"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_opme_item_supplier_supplier"
          FOREIGN KEY ("supplier_id")
          REFERENCES "supplier"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "opme_item"
        DROP COLUMN IF EXISTS "distributor"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "opme_item_supplier"`);

    await queryRunner.query(`
      ALTER TABLE "opme_item"
        ADD COLUMN IF NOT EXISTS "distributor" varchar(75)
    `);
  }
}
