import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela `clinics` — locais de atendimento da conta, com a grade
 * semanal de funcionamento em `business_hours` (jsonb).
 *
 * Não aperta o schema (sem UNIQUE, sem NOT NULL em coluna existente), então
 * não precisa de entrada no preflight de `data-checks.ts`.
 */
export class CreateClinics1755600000000 implements MigrationInterface {
  name = 'CreateClinics1755600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "clinics" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(150) NOT NULL,
        "cnpj" character varying(20),
        "email" character varying(100),
        "phone" character varying(15),
        "zip_code" character varying(10),
        "address" character varying(200),
        "address_number" character varying(20),
        "neighborhood" character varying(100),
        "city" character varying(100),
        "state" character(2),
        "business_hours" jsonb NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "owner_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_clinics" PRIMARY KEY ("id"),
        CONSTRAINT "FK_clinics_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_clinics_owner_id" ON "clinics" ("owner_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clinics";`);
  }
}
