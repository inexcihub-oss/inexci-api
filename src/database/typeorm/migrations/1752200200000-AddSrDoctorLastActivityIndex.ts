import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSrDoctorLastActivityIndex1752200200000 implements MigrationInterface {
  name = 'AddSrDoctorLastActivityIndex1752200200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sr_doctor_last_activity" ON "surgery_requests" ("doctor_id", "last_activity_at" DESC);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_sr_doctor_last_activity";`,
    );
  }
}
