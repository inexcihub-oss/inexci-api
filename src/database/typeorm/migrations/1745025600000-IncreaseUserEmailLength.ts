import { MigrationInterface, QueryRunner } from 'typeorm';

export class IncreaseUserEmailLength1745025600000 implements MigrationInterface {
  name = 'IncreaseUserEmailLength1745025600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "email" TYPE varchar(160)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "email" TYPE varchar(100)`,
    );
  }
}
