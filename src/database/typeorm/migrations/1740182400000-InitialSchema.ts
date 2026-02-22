import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration única consolidada.
 * Gerada em 22/02/2026 — substitui todas as migrations anteriores:
 *  - 1738700000000-InitialSchema
 *  - 1738700001000-FixDefaultDocumentClinic
 *  - 1738700002000-FixRecoveryCodeExpiresAt
 *  - 1738700004000-AddCreatedByToDefaultDocumentClinic
 */
export class InitialSchema1740182400000 implements MigrationInterface {
  name = 'InitialSchema1740182400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------ //
    // Extensões
    // ------------------------------------------------------------------ //
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ------------------------------------------------------------------ //
    // Função utilitária: gera protocolo de 6 dígitos único
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION generate_protocol()
      RETURNS VARCHAR AS $$
      DECLARE
        new_protocol VARCHAR;
        protocol_exists BOOLEAN;
      BEGIN
        LOOP
          new_protocol := LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0');
          SELECT EXISTS(SELECT 1 FROM surgery_request WHERE protocol = new_protocol) INTO protocol_exists;
          IF NOT protocol_exists THEN
            RETURN new_protocol;
          END IF;
        END LOOP;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ------------------------------------------------------------------ //
    // Tabela: user
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "role"       character varying(20) NOT NULL,
        "status"     integer NOT NULL DEFAULT '2',
        "email"      character varying NOT NULL,
        "password"   character varying NOT NULL,
        "name"       character varying NOT NULL,
        "phone"      character varying,
        "cpf"        character varying,
        "gender"     character varying(1),
        "birth_date" TIMESTAMP,
        "avatar_url" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_email" UNIQUE ("email"),
        CONSTRAINT "PK_user"      PRIMARY KEY ("id")
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: doctor_profile
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "doctor_profile" (
        "id"                       UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"                  UUID NOT NULL,
        "specialty"                character varying NOT NULL,
        "crm"                      character varying NOT NULL,
        "crm_state"                character varying(2) NOT NULL,
        "signature_url"            character varying,
        "clinic_name"              character varying,
        "clinic_cnpj"              character varying,
        "clinic_address"           character varying,
        "subscription_status"      character varying NOT NULL DEFAULT 'trial',
        "subscription_plan"        character varying DEFAULT 'basic',
        "subscription_expires_at"  TIMESTAMP,
        "max_requests_per_month"   integer DEFAULT '100',
        "max_team_members"         integer DEFAULT '5',
        "created_at"               TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_doctor_profile_user_id" UNIQUE ("user_id"),
        CONSTRAINT "PK_doctor_profile"         PRIMARY KEY ("id"),
        CONSTRAINT "FK_doctor_profile_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: team_member
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "team_member" (
        "id"                   UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"            UUID NOT NULL,
        "collaborator_id"      UUID NOT NULL,
        "role"                 integer NOT NULL DEFAULT '0',
        "status"               integer NOT NULL DEFAULT '1',
        "can_create_requests"  boolean NOT NULL DEFAULT false,
        "can_edit_requests"    boolean NOT NULL DEFAULT false,
        "can_delete_requests"  boolean NOT NULL DEFAULT false,
        "can_manage_documents" boolean NOT NULL DEFAULT false,
        "can_manage_patients"  boolean NOT NULL DEFAULT false,
        "can_manage_billing"   boolean NOT NULL DEFAULT false,
        "can_manage_team"      boolean NOT NULL DEFAULT false,
        "can_view_reports"     boolean NOT NULL DEFAULT false,
        "notes"                text,
        "invited_at"           TIMESTAMP NOT NULL DEFAULT now(),
        "accepted_at"          TIMESTAMP,
        "created_at"           TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_team_member" PRIMARY KEY ("id"),
        CONSTRAINT "FK_team_member_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_team_member_collaborator"
          FOREIGN KEY ("collaborator_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE UNIQUE INDEX "IDX_doctor_collaborator"
        ON "team_member" ("doctor_id", "collaborator_id");
    `);

    // ------------------------------------------------------------------ //
    // Tabela: hospital
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "hospital" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"           character varying NOT NULL,
        "cnpj"           character varying,
        "email"          character varying,
        "phone"          character varying,
        "contact_name"   character varying,
        "contact_phone"  character varying,
        "contact_email"  character varying,
        "zip_code"       character varying,
        "address"        character varying,
        "address_number" character varying,
        "neighborhood"   character varying,
        "city"           character varying,
        "state"          character varying(2),
        "active"         boolean NOT NULL DEFAULT true,
        "doctor_id"      UUID NOT NULL,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hospital" PRIMARY KEY ("id"),
        CONSTRAINT "FK_hospital_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: health_plan
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "health_plan" (
        "id"                     UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"                   character varying NOT NULL,
        "ans_code"               character varying,
        "cnpj"                   character varying,
        "email"                  character varying,
        "phone"                  character varying,
        "authorization_contact"  character varying,
        "authorization_phone"    character varying,
        "authorization_email"    character varying,
        "website"                character varying,
        "portal_url"             character varying,
        "notes"                  text,
        "active"                 boolean NOT NULL DEFAULT true,
        "default_payment_days"   integer,
        "doctor_id"              UUID NOT NULL,
        "created_at"             TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"             TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_health_plan" PRIMARY KEY ("id"),
        CONSTRAINT "FK_health_plan_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: supplier
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "supplier" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"           character varying NOT NULL,
        "cnpj"           character varying,
        "email"          character varying,
        "phone"          character varying,
        "contact_name"   character varying,
        "contact_phone"  character varying,
        "contact_email"  character varying,
        "zip_code"       character varying,
        "address"        character varying,
        "address_number" character varying,
        "neighborhood"   character varying,
        "city"           character varying,
        "state"          character varying(2),
        "notes"          text,
        "active"         boolean NOT NULL DEFAULT true,
        "doctor_id"      UUID NOT NULL,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supplier_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: cid
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "cid" (
        "id"          character varying NOT NULL,
        "description" character varying NOT NULL,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cid" PRIMARY KEY ("id")
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: procedure
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "procedure" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "active"     boolean NOT NULL DEFAULT true,
        "tuss_code"  character varying NOT NULL,
        "name"       character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_procedure_tuss_code" UNIQUE ("tuss_code"),
        CONSTRAINT "PK_procedure"           PRIMARY KEY ("id")
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: patient
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "patient" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"           UUID NOT NULL,
        "name"                character varying NOT NULL,
        "email"               character varying,
        "phone"               character varying NOT NULL,
        "cpf"                 character varying NOT NULL,
        "gender"              character varying(1) NOT NULL,
        "birth_date"          TIMESTAMP NOT NULL,
        "health_plan_id"      UUID NOT NULL,
        "health_plan_number"  character varying NOT NULL,
        "health_plan_type"    character varying NOT NULL,
        "zip_code"            character varying,
        "address"             character varying,
        "address_number"      character varying,
        "address_complement"  character varying,
        "neighborhood"        character varying,
        "city"                character varying,
        "state"               character varying(2),
        "medical_notes"       text,
        "active"              boolean NOT NULL DEFAULT true,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient" PRIMARY KEY ("id"),
        CONSTRAINT "FK_patient_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_patient_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plan"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: surgery_request
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request" (
        "id"                      UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"               UUID NOT NULL,
        "created_by_id"           UUID NOT NULL,
        "manager_id"              UUID,
        "patient_id"              UUID NOT NULL,
        "hospital_id"             UUID,
        "health_plan_id"          UUID,
        "cid_id"                  character varying,
        "cid_description"         character varying(255),
        "status"                  integer NOT NULL DEFAULT '1',
        "protocol"                character varying DEFAULT generate_protocol(),
        "priority"                integer NOT NULL DEFAULT '2',
        "deadline"                TIMESTAMP,
        "is_indication"           boolean NOT NULL DEFAULT false,
        "indication_name"         character varying,
        "health_plan_registration" character varying,
        "health_plan_type"        character varying,
        "health_plan_protocol"    character varying,
        "diagnosis"               text,
        "medical_report"          text,
        "patient_history"         text,
        "surgery_description"     text,
        "date_options"            jsonb,
        "selected_date_index"     integer,
        "surgery_date"            TIMESTAMP,
        "analysis_started_at"     TIMESTAMP,
        "date_call"               TIMESTAMP,
        "hospital_protocol"       character varying,
        "sent_at"                 TIMESTAMP,
        "send_method"             character varying(20),
        "surgery_performed_at"    TIMESTAMP,
        "cancel_reason"           text,
        "closed_at"               TIMESTAMP,
        "created_at"              TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_surgery_request_protocol" UNIQUE ("protocol"),
        CONSTRAINT "PK_surgery_request"          PRIMARY KEY ("id"),
        CONSTRAINT "FK_surgery_request_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_surgery_request_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "FK_surgery_request_manager"
          FOREIGN KEY ("manager_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "FK_surgery_request_patient"
          FOREIGN KEY ("patient_id") REFERENCES "patient"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_surgery_request_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospital"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "FK_surgery_request_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plan"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: surgery_request_procedure
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request_procedure" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "procedure_id"        UUID NOT NULL,
        "quantity"            integer NOT NULL DEFAULT '1',
        "authorized_quantity" integer,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_procedure" PRIMARY KEY ("id"),
        CONSTRAINT "FK_srp_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_srp_procedure"
          FOREIGN KEY ("procedure_id") REFERENCES "procedure"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: opme_item
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "opme_item" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "name"                character varying NOT NULL,
        "brand"               character varying,
        "distributor"         character varying,
        "quantity"            integer NOT NULL DEFAULT '1',
        "authorized_quantity" integer,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_opme_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_opme_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: surgery_request_quotation
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request_quotation" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "supplier_id"         UUID NOT NULL,
        "proposal_number"     character varying,
        "total_value"         numeric(19,2),
        "submission_date"     date,
        "valid_until"         date,
        "notes"               text,
        "selected"            boolean NOT NULL DEFAULT false,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_quotation" PRIMARY KEY ("id"),
        CONSTRAINT "FK_quotation_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_quotation_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: contestation  (antes de document, pois document tem FK aqui)
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "contestation" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "created_by_id"       UUID NOT NULL,
        "type"                character varying(50) NOT NULL,
        "reason"              text NOT NULL,
        "resolved_at"         TIMESTAMP,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contestation" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contestation_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_contestation_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: document
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "document" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "created_by"          UUID NOT NULL,
        "type"                character varying(75) NOT NULL DEFAULT 'additional_document',
        "key"                 character varying NOT NULL,
        "name"                character varying NOT NULL,
        "uri"                 character varying,
        "contestation_id"     UUID,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document" PRIMARY KEY ("id"),
        CONSTRAINT "FK_document_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_document_user"
          FOREIGN KEY ("created_by") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_document_contestation"
          FOREIGN KEY ("contestation_id") REFERENCES "contestation"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: status_update
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "status_update" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "prev_status"         integer NOT NULL,
        "new_status"          integer NOT NULL,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_status_update" PRIMARY KEY ("id"),
        CONSTRAINT "FK_status_update_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: surgery_request_analysis
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request_analysis" (
        "id"                    UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"    UUID NOT NULL,
        "request_number"        character varying(100) NOT NULL,
        "received_at"           TIMESTAMP NOT NULL,
        "quotation_1_number"    character varying(100),
        "quotation_1_received_at" TIMESTAMP,
        "quotation_2_number"    character varying(100),
        "quotation_2_received_at" TIMESTAMP,
        "quotation_3_number"    character varying(100),
        "quotation_3_received_at" TIMESTAMP,
        "notes"                 text,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_surgery_request_analysis_sr_id" UNIQUE ("surgery_request_id"),
        CONSTRAINT "PK_surgery_request_analysis"        PRIMARY KEY ("id"),
        CONSTRAINT "FK_sra_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: surgery_request_billing
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request_billing" (
        "id"                          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"          UUID NOT NULL,
        "created_by_id"               UUID NOT NULL,
        "invoice_protocol"            character varying(100) NOT NULL,
        "invoice_sent_at"             TIMESTAMP NOT NULL,
        "invoice_value"               numeric(12,2) NOT NULL,
        "payment_deadline"            date,
        "received_value"              numeric(12,2),
        "received_at"                 TIMESTAMP,
        "receipt_notes"               text,
        "contested_received_value"    numeric(12,2),
        "contested_received_at"       TIMESTAMP,
        "contested_receipt_notes"     text,
        "created_at"                  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_surgery_request_billing_sr_id" UNIQUE ("surgery_request_id"),
        CONSTRAINT "PK_surgery_request_billing"       PRIMARY KEY ("id"),
        CONSTRAINT "FK_srb_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_srb_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: surgery_request_template
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request_template" (
        "id"            UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"     UUID NOT NULL,
        "name"          character varying(100) NOT NULL,
        "template_data" jsonb NOT NULL,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_template" PRIMARY KEY ("id"),
        CONSTRAINT "FK_srt_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: chat
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "chat" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "user_id"             UUID NOT NULL,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_chat_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: chat_message
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "chat_message" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "chat_id"    UUID NOT NULL,
        "sender_id"  UUID NOT NULL,
        "read"       boolean NOT NULL DEFAULT false,
        "message"    text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_message" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_message_chat"
          FOREIGN KEY ("chat_id") REFERENCES "chat"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_chat_message_sender"
          FOREIGN KEY ("sender_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: notification
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "notification" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "type"       character varying NOT NULL,
        "title"      character varying NOT NULL,
        "message"    text NOT NULL,
        "read"       boolean NOT NULL DEFAULT false,
        "link"       character varying,
        "metadata"   jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: user_notification_settings
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "user_notification_settings" (
        "id"                   UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"              UUID NOT NULL,
        "email_notifications"  boolean NOT NULL DEFAULT true,
        "sms_notifications"    boolean NOT NULL DEFAULT false,
        "push_notifications"   boolean NOT NULL DEFAULT true,
        "new_surgery_request"  boolean NOT NULL DEFAULT true,
        "status_update"        boolean NOT NULL DEFAULT true,
        "pendencies"           boolean NOT NULL DEFAULT true,
        "expiring_documents"   boolean NOT NULL DEFAULT true,
        "weekly_report"        boolean NOT NULL DEFAULT false,
        "created_at"           TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_notification_settings_user" UNIQUE ("user_id"),
        CONSTRAINT "PK_user_notification_settings"       PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_notification_settings_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: default_document_clinic
    // Coluna `created_by` presente desde o início (sem updated_at).
    // FK doctor_id → doctor_profile (não user).
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "default_document_clinic" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"   UUID NOT NULL,
        "created_by"  UUID NOT NULL,
        "key"         character varying(50) NOT NULL,
        "name"        character varying(100) NOT NULL,
        "file_url"    character varying(255),
        "description" text,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_default_document_clinic" PRIMARY KEY ("id"),
        CONSTRAINT "FK_default_document_clinic_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_default_document_clinic_created_by"
          FOREIGN KEY ("created_by") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: recovery_code
    // expires_at é nullable (sem NOT NULL).
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "recovery_code" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "code"       character varying NOT NULL,
        "expires_at" TIMESTAMP,
        "used"       boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recovery_code" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recovery_code_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "recovery_code"                CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "default_document_clinic"      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user_notification_settings"   CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "notification"                 CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "chat_message"                 CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "chat"                         CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_template"     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_billing"      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_analysis"     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "status_update"                CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "document"                     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "contestation"                 CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_quotation"    CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "opme_item"                    CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_procedure"    CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request"              CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "patient"                      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "procedure"                    CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "cid"                          CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "supplier"                     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "health_plan"                  CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "hospital"                     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "team_member"                  CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "doctor_profile"               CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user"                         CASCADE`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS generate_protocol`);
  }
}
