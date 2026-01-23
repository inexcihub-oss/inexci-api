import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration para remover a tabela de pendências.
 *
 * As pendências agora são calculadas dinamicamente baseadas nos dados
 * da solicitação, não necessitando mais de uma tabela separada.
 *
 * A validação de pendências é feita pelo PendencyValidatorService
 * que verifica os dados da solicitação em tempo real.
 */
export class DropPendencyTable1768712600000 implements MigrationInterface {
  name = 'DropPendencyTable1768712600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Dropar a tabela de pendências
    await queryRunner.query(`DROP TABLE IF EXISTS "pendency" CASCADE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recriar a tabela pendency caso precise reverter
    await queryRunner.query(`
      CREATE TABLE "pendency" (
        "id" SERIAL NOT NULL,
        "surgery_request_id" integer NOT NULL,
        "responsible_id" integer,
        "key" character varying(100) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "created_manually" boolean DEFAULT false,
        "concluded_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pendency" PRIMARY KEY ("id")
      )
    `);

    // Recriar as foreign keys
    await queryRunner.query(`
      ALTER TABLE "pendency"
      ADD CONSTRAINT "FK_pendency_surgery_request"
      FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "pendency"
      ADD CONSTRAINT "FK_pendency_responsible"
      FOREIGN KEY ("responsible_id") REFERENCES "user"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Recriar índices
    await queryRunner.query(`
      CREATE INDEX "IDX_pendency_surgery_request_id" ON "pendency" ("surgery_request_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pendency_key" ON "pendency" ("key")
    `);
  }
}
