import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupplierCommercialFields1745300000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier"
        ADD COLUMN IF NOT EXISTS "website" varchar(200),
        ADD COLUMN IF NOT EXISTS "category" varchar(50),
        ADD COLUMN IF NOT EXISTS "payment_terms" varchar(50),
        ADD COLUMN IF NOT EXISTS "delivery_time" varchar(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier"
        DROP COLUMN IF EXISTS "website",
        DROP COLUMN IF EXISTS "category",
        DROP COLUMN IF EXISTS "payment_terms",
        DROP COLUMN IF EXISTS "delivery_time"
    `);
  }
}
