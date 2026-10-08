import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Salas (consultórios) dentro de uma clínica. Tabela nova: as chaves
 * estrangeiras nascem com ela, sem dado legado para conferir.
 * Ver `planos-implementacao/MIG-03-agenda-salas-encaixe-sala-de-espera.md`.
 */
export class CreateClinicRooms1755800300000 implements MigrationInterface {
  name = 'CreateClinicRooms1755800300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "clinic_rooms" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "clinic_id" uuid NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
         "name" character varying(80) NOT NULL,
         "active" boolean NOT NULL DEFAULT true,
         "created_at" TIMESTAMP NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
         "deleted_at" TIMESTAMP,
         CONSTRAINT "PK_clinic_rooms" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinic_rooms_clinic_id" ON "clinic_rooms" ("clinic_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clinic_rooms"`);
  }
}
