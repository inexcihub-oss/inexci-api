import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sub-tabelas e relacionamentos da solicitação cirúrgica:
 *  - surgery_request_tuss_items
 *  - opme_items + opme_item_suppliers (junction)
 *  - surgery_request_quotations
 *  - contestations
 *  - documents (depende de contestations)
 *  - surgery_request_analyses
 *  - surgery_request_billings
 *  - surgery_request_templates
 *  - surgery_request_activities
 *  - report_sections
 *  - stale_notification_logs
 */
export class CreateSurgeryRequestRelations1746144500000 implements MigrationInterface {
  name = 'CreateSurgeryRequestRelations1746144500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "surgery_request_tuss_items" (
        "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id"  UUID NOT NULL,
        "tuss_code"           VARCHAR(50) NOT NULL,
        "name"                VARCHAR(255) NOT NULL,
        "quantity"            INTEGER NOT NULL DEFAULT 1,
        "authorized_quantity" INTEGER,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_tuss_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tuss_items_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_tuss_items_sr_id" ON "surgery_request_tuss_items" ("surgery_request_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "opme_items" (
        "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id"  UUID NOT NULL,
        "name"                VARCHAR(75) NOT NULL,
        "brand"               VARCHAR(75),
        "quantity"            INTEGER NOT NULL DEFAULT 1,
        "authorized_quantity" INTEGER,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_opme_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_opme_items_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_opme_items_sr_id" ON "opme_items" ("surgery_request_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "opme_item_suppliers" (
        "opme_item_id" UUID NOT NULL,
        "supplier_id"  UUID NOT NULL,
        CONSTRAINT "pk_opme_item_suppliers" PRIMARY KEY ("opme_item_id", "supplier_id"),
        CONSTRAINT "fk_ois_opme_item"
          FOREIGN KEY ("opme_item_id") REFERENCES "opme_items"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_ois_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "surgery_request_quotations" (
        "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id" UUID NOT NULL,
        "supplier_id"        UUID NOT NULL,
        "proposal_number"    VARCHAR(100),
        "total_value"        NUMERIC(19, 2),
        "submission_date"    DATE,
        "valid_until"        DATE,
        "notes"              TEXT,
        "selected"           BOOLEAN NOT NULL DEFAULT false,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_quotations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_quotations_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_quotations_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_quotations_sr_id" ON "surgery_request_quotations" ("surgery_request_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "contestations" (
        "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id" UUID NOT NULL,
        "created_by_id"      UUID NOT NULL,
        "type"               "contestation_type_enum" NOT NULL,
        "reason"             TEXT NOT NULL,
        "resolved_at"        TIMESTAMP,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contestations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_contestations_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_contestations_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_contestations_sr_id" ON "contestations" ("surgery_request_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "documents" (
        "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id" UUID NOT NULL,
        "created_by_id"      UUID NOT NULL,
        "type"               VARCHAR(75) NOT NULL DEFAULT 'additional_document',
        "key"                VARCHAR(50) NOT NULL,
        "name"               VARCHAR(75) NOT NULL,
        "uri"                VARCHAR(255),
        "contestation_id"    UUID,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_documents" PRIMARY KEY ("id"),
        CONSTRAINT "fk_documents_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_documents_user"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_documents_contestation"
          FOREIGN KEY ("contestation_id") REFERENCES "contestations"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_documents_sr_id" ON "documents" ("surgery_request_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "surgery_request_analyses" (
        "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id"      UUID NOT NULL,
        "request_number"          VARCHAR(100) NOT NULL,
        "received_at"             TIMESTAMP NOT NULL,
        "quotation_1_number"      VARCHAR(100),
        "quotation_1_received_at" TIMESTAMP,
        "quotation_2_number"      VARCHAR(100),
        "quotation_2_received_at" TIMESTAMP,
        "quotation_3_number"      VARCHAR(100),
        "quotation_3_received_at" TIMESTAMP,
        "notes"                   TEXT,
        "created_at"              TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_analyses" PRIMARY KEY ("id"),
        CONSTRAINT "uq_sra_sr_id" UNIQUE ("surgery_request_id"),
        CONSTRAINT "fk_sra_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "surgery_request_billings" (
        "id"                       UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id"       UUID NOT NULL,
        "created_by_id"            UUID NOT NULL,
        "invoice_protocol"         VARCHAR(100) NOT NULL,
        "invoice_sent_at"          TIMESTAMP NOT NULL,
        "invoice_value"            NUMERIC(12, 2) NOT NULL,
        "payment_deadline"         DATE,
        "received_value"           NUMERIC(12, 2),
        "received_at"              TIMESTAMP,
        "receipt_notes"            TEXT,
        "contested_received_value" NUMERIC(12, 2),
        "contested_received_at"    TIMESTAMP,
        "contested_receipt_notes"  TEXT,
        "created_at"               TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_billings" PRIMARY KEY ("id"),
        CONSTRAINT "uq_srb_sr_id" UNIQUE ("surgery_request_id"),
        CONSTRAINT "fk_srb_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_srb_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "surgery_request_templates" (
        "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
        "doctor_id"     UUID NOT NULL,
        "owner_id"      UUID NOT NULL,
        "name"          VARCHAR(100) NOT NULL,
        "template_data" JSONB NOT NULL,
        "usage_count"   INTEGER NOT NULL DEFAULT 0,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_templates" PRIMARY KEY ("id"),
        CONSTRAINT "fk_srt_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_srt_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_srt_doctor_id" ON "surgery_request_templates" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_srt_owner_id"  ON "surgery_request_templates" ("owner_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "surgery_request_activities" (
        "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id" UUID NOT NULL,
        "user_id"            UUID,
        "type"               "activity_type_enum" NOT NULL DEFAULT 'comment',
        "content"            TEXT NOT NULL,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_activities" PRIMARY KEY ("id"),
        CONSTRAINT "fk_activities_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_activities_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_activities_sr_id"     ON "surgery_request_activities" ("surgery_request_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activities_created_at" ON "surgery_request_activities" ("created_at" DESC);`,
    );

    await queryRunner.query(`
      CREATE TABLE "report_sections" (
        "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
        "title"              VARCHAR(255) NOT NULL,
        "description"        TEXT,
        "order"              INTEGER NOT NULL DEFAULT 0,
        "surgery_request_id" UUID NOT NULL,
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_report_sections" PRIMARY KEY ("id"),
        CONSTRAINT "fk_report_sections_sr"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_report_sections_sr_id" ON "report_sections" ("surgery_request_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "stale_notification_logs" (
        "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
        "surgery_request_id" UUID NOT NULL,
        "stale_days"         INTEGER NOT NULL,
        "channel"            VARCHAR(20) NOT NULL DEFAULT 'in_app',
        "notified_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_stale_notification_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_stale_logs_sr"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_stale_logs_sr_days" ON "stale_notification_logs" ("surgery_request_id", "stale_days");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'stale_notification_logs',
      'report_sections',
      'surgery_request_activities',
      'surgery_request_templates',
      'surgery_request_billings',
      'surgery_request_analyses',
      'documents',
      'contestations',
      'surgery_request_quotations',
      'opme_item_suppliers',
      'opme_items',
      'surgery_request_tuss_items',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }
  }
}
