import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeparateTussAndProcedure1740355200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Criar tabela surgery_request_tuss_item
    await queryRunner.query(`
      CREATE TABLE "surgery_request_tuss_item" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "tuss_code"           VARCHAR(50) NOT NULL,
        "name"                VARCHAR(255) NOT NULL,
        "quantity"            INT NOT NULL DEFAULT 1,
        "authorized_quantity" INT,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_tuss_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tuss_item_surgery_request"
          FOREIGN KEY ("surgery_request_id")
          REFERENCES "surgery_request"("id")
          ON DELETE CASCADE
      )
    `);

    // 2. Remover coluna tuss_code da tabela procedure
    await queryRunner.query(
      `ALTER TABLE "procedure" DROP COLUMN IF EXISTS "tuss_code"`,
    );

    // 3. Remover coluna active da tabela procedure
    await queryRunner.query(
      `ALTER TABLE "procedure" DROP COLUMN IF EXISTS "active"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_request_tuss_item"`);
    await queryRunner.query(
      `ALTER TABLE "procedure" ADD COLUMN IF NOT EXISTS "tuss_code" VARCHAR(100) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "procedure" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true`,
    );
  }
}
