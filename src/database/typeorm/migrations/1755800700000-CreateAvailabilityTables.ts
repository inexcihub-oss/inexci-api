import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAvailabilityTables1755800700000 implements MigrationInterface {
  name = 'CreateAvailabilityTables1755800700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "doctor_schedules" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "doctor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "clinic_id" uuid REFERENCES "clinics"("id") ON DELETE SET NULL,
         "room_id" uuid REFERENCES "clinic_rooms"("id") ON DELETE SET NULL,
         "weekday" smallint NOT NULL CHECK ("weekday" BETWEEN 0 AND 6),
         "start_time" time NOT NULL,
         "end_time" time NOT NULL,
         "slot_minutes" smallint NOT NULL DEFAULT 30 CHECK ("slot_minutes" BETWEEN 5 AND 240),
         "max_walk_ins" smallint,
         "valid_from" date,
         "valid_to" date,
         "active" boolean NOT NULL DEFAULT true,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "deleted_at" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_doctor_schedules" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_doctor_schedules_time" CHECK ("start_time" < "end_time")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_doctor_schedules_doctor_weekday" ON "doctor_schedules" ("doctor_id", "weekday")`,
    );

    await queryRunner.query(
      `CREATE TABLE "schedule_blocks" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "doctor_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
         "clinic_id" uuid REFERENCES "clinics"("id") ON DELETE CASCADE,
         "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         "all_day" boolean NOT NULL DEFAULT false,
         "reason" character varying(200),
         "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "deleted_at" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_schedule_blocks" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_schedule_blocks_range" CHECK ("starts_at" < "ends_at")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_schedule_blocks_doctor_range" ON "schedule_blocks" ("doctor_id", "starts_at", "ends_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_schedule_blocks_owner_range" ON "schedule_blocks" ("owner_id", "starts_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE "holidays" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "name" character varying(100) NOT NULL,
         "date" date NOT NULL,
         "recurring" boolean NOT NULL DEFAULT false,
         "blocks_agenda" boolean NOT NULL DEFAULT true,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "deleted_at" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_holidays" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_holidays_owner_date" ON "holidays" ("owner_id", "date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "holidays"`);
    await queryRunner.query(`DROP TABLE "schedule_blocks"`);
    await queryRunner.query(`DROP TABLE "doctor_schedules"`);
  }
}
