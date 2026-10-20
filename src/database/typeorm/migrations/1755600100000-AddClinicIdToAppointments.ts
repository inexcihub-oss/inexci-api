import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClinicIdToAppointments1755600100000 implements MigrationInterface {
  name = 'AddClinicIdToAppointments1755600100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN "clinic_id" uuid ` +
        `REFERENCES "clinics"("id") ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_clinic_id" ON "appointments" ("clinic_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_appointments_clinic_id";`);
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "clinic_id";`,
    );
  }
}
