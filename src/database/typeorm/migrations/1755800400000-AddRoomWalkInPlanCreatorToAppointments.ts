import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoomWalkInPlanCreatorToAppointments1755800400000 implements MigrationInterface {
  name = 'AddRoomWalkInPlanCreatorToAppointments1755800400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments"
         ADD COLUMN "room_id" uuid REFERENCES "clinic_rooms"("id") ON DELETE SET NULL,
         ADD COLUMN "is_walk_in" boolean NOT NULL DEFAULT false,
         ADD COLUMN "health_plan_id" uuid REFERENCES "health_plans"("id") ON DELETE SET NULL,
         ADD COLUMN "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_room_id" ON "appointments" ("room_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "appointments" SET "status" = 'confirmed'
        WHERE "status" IN ('waiting', 'in_progress')`,
    );
    await queryRunner.query(`DROP INDEX "idx_appointments_room_id"`);
    await queryRunner.query(
      `ALTER TABLE "appointments"
         DROP COLUMN "created_by_id",
         DROP COLUMN "health_plan_id",
         DROP COLUMN "is_walk_in",
         DROP COLUMN "room_id"`,
    );
  }
}
