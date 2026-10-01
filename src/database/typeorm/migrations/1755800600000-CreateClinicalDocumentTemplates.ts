import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Modelos de texto de atestado e pedido de exame (MIG-06). Tabela nova, sem
 * dado legado para conferir. `kind` em `varchar(30)` (não enum do Postgres):
 * tipo novo de documento não exige migration.
 */
export class CreateClinicalDocumentTemplates1755800600000 implements MigrationInterface {
  name = 'CreateClinicalDocumentTemplates1755800600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "clinical_document_templates" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "doctor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
         "kind" character varying(30) NOT NULL,
         "name" character varying(100) NOT NULL,
         "body" text NOT NULL,
         "usage_count" integer NOT NULL DEFAULT 0,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "deleted_at" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_clinical_document_templates" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cdt_owner_id" ON "clinical_document_templates" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cdt_doctor_kind" ON "clinical_document_templates" ("doctor_id", "kind")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clinical_document_templates"`);
  }
}
