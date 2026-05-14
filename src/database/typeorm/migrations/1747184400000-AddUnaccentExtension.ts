import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnaccentExtension1747184400000 implements MigrationInterface {
  name = 'AddUnaccentExtension1747184400000';

  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
