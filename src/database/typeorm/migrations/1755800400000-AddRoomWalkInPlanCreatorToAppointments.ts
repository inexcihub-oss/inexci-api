import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consulta ganha sala, encaixe, convênio e quem agendou — todos opcionais ou
 * com default que reproduz o comportamento atual (`is_walk_in = false`).
 * Colunas novas: as chaves estrangeiras não têm dado legado para violar.
 *
 * Os status novos (`waiting`, `in_progress`) não precisam de DDL: `status` é
 * `varchar(20)`, não enum do Postgres.
 */
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

  /**
   * Reverter apaga sala, encaixe, convênio e autor das consultas. Consulta em
   * `waiting`/`in_progress` volta a ser um status que o código antigo não
   * conhece; o `down` a devolve para `confirmed` em vez de deixá-la órfã.
   */
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
