import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpmeItemSuppliersIndex1752200100000 implements MigrationInterface {
  name = 'AddOpmeItemSuppliersIndex1752200100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_opme_item_suppliers_supplier_id" ON "opme_item_suppliers" ("supplier_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_opme_item_suppliers_supplier_id";`,
    );
  }
}
