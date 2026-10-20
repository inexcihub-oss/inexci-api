import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionsToUsers1752300700000 implements MigrationInterface {
  name = 'AddPermissionsToUsers1752300700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "permissions" text array NOT NULL DEFAULT '{}'`,
    );

    await queryRunner.query(`
      UPDATE "users"
         SET "permissions" = ARRAY['agenda','atendimento','solicitacoes']::text[]
       WHERE "role" = 'collaborator'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "permissions"`);
  }
}
