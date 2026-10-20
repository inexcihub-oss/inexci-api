import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenOpmeItemNameColumn1755700300000 implements MigrationInterface {
  name = 'WidenOpmeItemNameColumn1755700300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "opme_items" ALTER COLUMN "name" TYPE character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const longos = await queryRunner.query(
      `SELECT id, name FROM "opme_items" WHERE length("name") > 75`,
    );
    if (longos.length > 0) {
      throw new Error(
        `Não é possível reverter: ${longos.length} registro(s) de opme_items têm "name" com mais de 75 caracteres (ex.: id ${longos[0].id}). Ajuste os dados manualmente antes de reverter.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "opme_items" ALTER COLUMN "name" TYPE character varying(75)`,
    );
  }
}
