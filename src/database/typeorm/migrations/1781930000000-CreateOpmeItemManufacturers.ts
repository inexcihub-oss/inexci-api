import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOpmeItemManufacturers1781930000000 implements MigrationInterface {
  name = 'CreateOpmeItemManufacturers1781930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "opme_item_manufacturers" (
        "opme_item_id" UUID NOT NULL,
        "manufacturer_id" UUID NOT NULL,
        CONSTRAINT "pk_opme_item_manufacturers"
          PRIMARY KEY ("opme_item_id", "manufacturer_id"),
        CONSTRAINT "fk_opme_item_manufacturers_opme_item"
          FOREIGN KEY ("opme_item_id") REFERENCES "opme_items"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_opme_item_manufacturers_manufacturer"
          FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturers"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_opme_item_manufacturers_opme_item_id"
      ON "opme_item_manufacturers" ("opme_item_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_opme_item_manufacturers_manufacturer_id"
      ON "opme_item_manufacturers" ("manufacturer_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_opme_item_manufacturers_manufacturer_id";
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_opme_item_manufacturers_opme_item_id";
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "opme_item_manufacturers";
    `);
  }
}
