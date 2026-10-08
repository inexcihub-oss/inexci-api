import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Histórico da consulta (MIG-04). Tabela nova: as chaves estrangeiras nascem
 * com ela, sem dado legado para conferir. `type` em `varchar(20)` (não enum do
 * Postgres), como `appointments.status`: tipo novo não exige migration.
 */
export class CreateAppointmentActivities1755800500000 implements MigrationInterface {
  name = 'CreateAppointmentActivities1755800500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "appointment_activities" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "appointment_id" uuid NOT NULL REFERENCES "appointments"("id") ON DELETE CASCADE,
         "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
         "type" character varying(20) NOT NULL DEFAULT 'comment',
         "from_status" character varying(20),
         "to_status" character varying(20),
         "content" text,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_appointment_activities" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointment_activities_appointment_created"
         ON "appointment_activities" ("appointment_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "appointment_activities"`);
  }
}
