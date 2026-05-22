import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCenterToDoctorHeaderLogoPosition1748000000000 implements MigrationInterface {
  name = 'AddCenterToDoctorHeaderLogoPosition1748000000000';

  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "doctor_header_logo_position_enum" ADD VALUE IF NOT EXISTS 'center'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
