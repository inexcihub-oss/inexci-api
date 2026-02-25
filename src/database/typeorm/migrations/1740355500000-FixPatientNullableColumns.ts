import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPatientNullableColumns1740355500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN cpf DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN gender DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN birth_date DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN health_plan_id DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN health_plan_number DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN health_plan_type DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN cpf SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN gender SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN birth_date SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN health_plan_id SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN health_plan_number SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE patient ALTER COLUMN health_plan_type SET NOT NULL`,
    );
  }
}
