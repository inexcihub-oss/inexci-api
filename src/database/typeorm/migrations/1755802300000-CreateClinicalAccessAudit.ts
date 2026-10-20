import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClinicalAccessAudit1755802300000 implements MigrationInterface {
  name = 'CreateClinicalAccessAudit1755802300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "clinical_access_audit" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "actor_user_id" uuid,
         "owner_id" uuid,
         "action" character varying(32) NOT NULL,
         "resource" character varying(32) NOT NULL,
         "resource_id" character varying(64),
         "patient_id" uuid,
         "origin" character varying(16) NOT NULL,
         "ip" character varying(64),
         "request_id" character varying(128),
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_clinical_access_audit" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_access_audit_owner_created"
         ON "clinical_access_audit" ("owner_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_access_audit_patient_created"
         ON "clinical_access_audit" ("patient_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_clinical_access_audit_created_at"
         ON "clinical_access_audit" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clinical_access_audit"`);
  }
}
