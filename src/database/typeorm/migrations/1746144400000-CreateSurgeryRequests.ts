import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabela principal do domínio: solicitações cirúrgicas.
 *
 * Mantida em uma migration separada (sem suas sub-tabelas) para permitir
 * rollback isolado caso seja necessário ajustar apenas esta entidade.
 *
 * O enum `SurgeryRequestStatus` (campo `status`) governa toda a state
 * machine da plataforma — ver `surgery-request.entity.ts` no domínio.
 */
export class CreateSurgeryRequests1746144400000 implements MigrationInterface {
  name = 'CreateSurgeryRequests1746144400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "surgery_requests" (
        "id"                       UUID NOT NULL DEFAULT gen_random_uuid(),
        "doctor_id"                UUID NOT NULL,
        "owner_id"                 UUID NOT NULL,
        "created_by_id"            UUID NOT NULL,
        "patient_id"               UUID NOT NULL,
        "hospital_id"              UUID,
        "health_plan_id"           UUID,
        "procedure_id"             UUID,
        "cid_code"                 VARCHAR(10),
        "status"                   SMALLINT NOT NULL DEFAULT 1,
        "protocol"                 VARCHAR(75) DEFAULT generate_protocol(),
        "priority"                 SMALLINT NOT NULL DEFAULT 2,
        "has_opme"                 BOOLEAN,
        "is_indication"            BOOLEAN NOT NULL DEFAULT false,
        "indication_name"          VARCHAR(100),
        "health_plan_registration" VARCHAR(100),
        "health_plan_type"         VARCHAR(100),
        "health_plan_protocol"     VARCHAR(100),
        "diagnosis"                TEXT,
        "medical_report"           TEXT,
        "patient_history"          TEXT,
        "surgery_description"      TEXT,
        "date_options"             JSONB,
        "selected_date_index"      INTEGER,
        "surgery_date"             TIMESTAMP,
        "analysis_started_at"      TIMESTAMP,
        "date_call"                TIMESTAMP,
        "hospital_protocol"        VARCHAR(100),
        "sent_at"                  TIMESTAMP,
        "send_method"              VARCHAR(20),
        "surgery_performed_at"     TIMESTAMP,
        "cancel_reason"            TEXT,
        "closed_at"                TIMESTAMP,
        "last_status_changed_at"   TIMESTAMP,
        "required_documents"       JSONB,
        "created_at"               TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_requests" PRIMARY KEY ("id"),
        CONSTRAINT "uq_surgery_requests_protocol" UNIQUE ("protocol"),
        CONSTRAINT "fk_surgery_requests_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_requests_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_requests_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_requests_patient"
          FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_requests_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_requests_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_requests_procedure"
          FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_sr_doctor_id"        ON "surgery_requests" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_owner_id"         ON "surgery_requests" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_doctor_status"    ON "surgery_requests" ("doctor_id", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_owner_status"     ON "surgery_requests" ("owner_id", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_status"           ON "surgery_requests" ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_created_at"       ON "surgery_requests" ("created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_health_plan_id"   ON "surgery_requests" ("health_plan_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_hospital_id"      ON "surgery_requests" ("hospital_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_patient_id"       ON "surgery_requests" ("patient_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_requests" CASCADE;`);
  }
}
