import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsPlatformAdminToUsers1752200300000 implements MigrationInterface {
  name = 'AddIsPlatformAdminToUsers1752200300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean NOT NULL DEFAULT false;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "is_platform_admin";`,
    );
  }
}
