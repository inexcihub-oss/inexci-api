import { MigrationInterface, QueryRunner } from 'typeorm';

export class MoveProcedureIdToSurgeryRequest1740355300000 implements MigrationInterface {
  name = 'MoveProcedureIdToSurgeryRequest1740355300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Adiciona procedure_id na tabela surgery_request
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD COLUMN "procedure_id" uuid NULL
    `);

    // 2. Migra os dados: copia o primeiro procedure_id de cada surgery_request_procedure
    await queryRunner.query(`
      UPDATE "surgery_request" sr
      SET "procedure_id" = (
        SELECT srp."procedure_id"
        FROM "surgery_request_procedure" srp
        WHERE srp."surgery_request_id" = sr."id"
        LIMIT 1
      )
    `);

    // 3. Adiciona foreign key
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      ADD CONSTRAINT "fk_surgery_request_procedure"
      FOREIGN KEY ("procedure_id")
      REFERENCES "procedure"("id")
      ON DELETE SET NULL
    `);

    // 4. Remove a tabela junction
    await queryRunner.query(`DROP TABLE "surgery_request_procedure"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove a FK
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      DROP CONSTRAINT "fk_surgery_request_procedure"
    `);

    // Remove a coluna
    await queryRunner.query(`
      ALTER TABLE "surgery_request"
      DROP COLUMN "procedure_id"
    `);

    // Recria a tabela junction (sem dados)
    await queryRunner.query(`
      CREATE TABLE "surgery_request_procedure" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" uuid NOT NULL,
        "procedure_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "authorized_quantity" integer,
        CONSTRAINT "PK_surgery_request_procedure" PRIMARY KEY ("id"),
        CONSTRAINT "FK_srp_surgery_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id"),
        CONSTRAINT "FK_srp_procedure" FOREIGN KEY ("procedure_id") REFERENCES "procedure"("id")
      )
    `);
  }
}
