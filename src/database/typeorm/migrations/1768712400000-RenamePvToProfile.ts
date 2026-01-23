import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePvToProfile1768712400000 implements MigrationInterface {
  name = 'RenamePvToProfile1768712400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Renomear coluna pv para profile na tabela user
    await queryRunner.query(
      `ALTER TABLE "user" RENAME COLUMN "pv" TO "profile"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverter: renomear coluna profile para pv na tabela user
    await queryRunner.query(
      `ALTER TABLE "user" RENAME COLUMN "profile" TO "pv"`,
    );
  }
}
