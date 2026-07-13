import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `opme_item_suppliers` só tinha a PK composta `(opme_item_id, supplier_id)`,
 * que cobre buscas por `opme_item_id` (coluna líder) mas não por `supplier_id`
 * isolado. `opme_item_manufacturers` (tabela irmã) já tinha índice nos dois
 * lados desde a migration original — este ajuste só corrige a assimetria.
 */
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
