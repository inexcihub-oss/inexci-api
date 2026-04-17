import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCidAndTussTables1745000100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Criar tabela CID
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cid" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" varchar(10) NOT NULL,
        "description" varchar(500) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cid" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cid_code" UNIQUE ("code")
      );
    `);

    // Criar tabela TUSS
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tuss" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" varchar(20) NOT NULL,
        "procedure" varchar(500) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tuss" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tuss_code" UNIQUE ("code")
      );
    `);

    // Criar índices para busca
    await queryRunner.query(`CREATE INDEX "IDX_cid_code" ON "cid" ("code");`);
    await queryRunner.query(`CREATE INDEX "IDX_tuss_code" ON "tuss" ("code");`);

    // Adicionar tuss_id na surgery_request (nullable para não quebrar dados existentes)
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD COLUMN IF NOT EXISTS "tuss_id" uuid NULL;
    `);

    // Alterar cid_id de varchar para uuid (nullable)
    // Primeiro dropar a coluna antiga e criar nova com tipo uuid
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ALTER COLUMN "cid_id" TYPE uuid USING NULL;
    `);

    // Adicionar FK constraints
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD CONSTRAINT "FK_surgery_request_cid" FOREIGN KEY ("cid_id") REFERENCES "cid"("id") ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD CONSTRAINT "FK_surgery_request_tuss" FOREIGN KEY ("tuss_id") REFERENCES "tuss"("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP CONSTRAINT IF EXISTS "FK_surgery_request_tuss";`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP CONSTRAINT IF EXISTS "FK_surgery_request_cid";`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN IF EXISTS "tuss_id";`,
    );
    await queryRunner.query(
      `ALTER TABLE "surgery_request" ALTER COLUMN "cid_id" TYPE varchar(75) USING NULL;`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tuss_code";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cid_code";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tuss";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cid";`);
  }
}
