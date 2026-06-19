import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateManufacturers1781830000000 implements MigrationInterface {
  name = 'CreateManufacturers1781830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "manufacturers" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "name" VARCHAR(150) NOT NULL,
        "cnpj" VARCHAR(20),
        "anvisa_registration" VARCHAR(50),
        "email" VARCHAR(100),
        "phone" VARCHAR(15),
        "website" VARCHAR(200),
        "country" VARCHAR(60),
        "contact_name" VARCHAR(100),
        "contact_phone" VARCHAR(15),
        "contact_email" VARCHAR(100),
        "notes" TEXT,
        "owner_id" UUID NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "pk_manufacturers" PRIMARY KEY ("id"),
        CONSTRAINT "fk_manufacturers_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_manufacturers_owner_id"
      ON "manufacturers" ("owner_id");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_manufacturers_owner_name_active"
      ON "manufacturers" ("owner_id", lower("name"))
      WHERE "deleted_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_manufacturers_owner_name_active";
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_manufacturers_owner_id";
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "manufacturers";
    `);
  }
}
