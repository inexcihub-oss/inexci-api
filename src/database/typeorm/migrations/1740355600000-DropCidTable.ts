import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove a coluna cid_description da tabela surgery_request
 * e dropa a tabela cid (desnecessária pois a descrição é resolvida
 * a partir do arquivo cid.json em memória).
 */
export class DropCidTable1740355600000 implements MigrationInterface {
  name = 'DropCidTable1740355600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove a coluna cid_description (a descrição será resolvida via JSON)
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      DROP COLUMN IF EXISTS "cid_description"
    `);

    // 2. Remove a tabela cid (substituída pelo cid.json em memória)
    await queryRunner.query(`DROP TABLE IF EXISTS "cid"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recria a tabela cid
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cid" (
        "id"          character varying(75) NOT NULL,
        "description" character varying(75) NOT NULL,
        CONSTRAINT "PK_cid" PRIMARY KEY ("id")
      )
    `);

    // Recria a coluna cid_description
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD COLUMN IF NOT EXISTS "cid_description" character varying(255)
    `);
  }
}
