import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClinicalSnippets1761000500000 implements MigrationInterface {
  name = 'CreateClinicalSnippets1761000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "clinical_snippets" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid NOT NULL,
         "doctor_id" uuid NOT NULL,
         "shortcut" character varying(40) NOT NULL,
         "title" character varying(100) NOT NULL,
         "content" text NOT NULL,
         "usage_count" integer NOT NULL DEFAULT 0,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "deleted_at" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_clinical_snippets" PRIMARY KEY ("id"),
         CONSTRAINT "FK_clinical_snippets_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_clinical_snippets_doctor" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_snippets_owner_id" ON "clinical_snippets" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_snippets_doctor_id" ON "clinical_snippets" ("doctor_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clinical_snippets"`);
  }
}
