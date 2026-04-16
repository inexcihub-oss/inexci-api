import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAddressFieldsToUser1740182400003 implements MigrationInterface {
  name = 'AddAddressFieldsToUser1740182400003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "cep" varchar(9)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "address" varchar(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "address_number" varchar(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "address_complement" varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "city" varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "state" varchar(2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "state"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "city"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "address_complement"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "address_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "address"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "cep"`);
  }
}
