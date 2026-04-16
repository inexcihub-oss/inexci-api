import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration consolidada — v3 do modelo de usuários e permissões.
 *
 * Alterações em relação ao schema anterior:
 * - user: removidos is_admin, is_doctor, crm, crm_state, specialty, signature_image_url
 * - user: adicionado account_id (FK self-ref para isolamento de tenant)
 * - user: role agora é enum('admin', 'collaborator') — sem 'doctor'
 * - user: status agora é enum('pending', 'active', 'inactive') em vez de smallint
 * - doctor_profile: removidos subscription_status, subscription_plan, subscription_expires_at,
 *                   max_requests_per_month, max_team_members
 * - team_member: REMOVIDA — substituída por user_doctor_access
 * - user_doctor_access: NOVA — controle binário de acesso médico↔usuário
 * - surgery_request.doctor_id → user.id (antes: doctor_profile.id)
 * - patient.doctor_id → user.id (antes: doctor_profile.id)
 * - default_document_clinic.doctor_id → user.id (antes: doctor_profile.id)
 * - hospital, health_plan, supplier: FK formal doctor_id → user.id
 * - Índices conforme seção 2.8 do PRD
 */
export class InitialSchema1740182400000 implements MigrationInterface {
  name = 'InitialSchema1740182400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------ //
    // Extensões
    // ------------------------------------------------------------------ //
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ------------------------------------------------------------------ //
    // Enums
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_role_enum" AS ENUM ('admin', 'collaborator');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_status_enum" AS ENUM ('pending', 'active', 'inactive');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_doctor_access_status_enum" AS ENUM ('active', 'inactive');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "activity_type_enum" AS ENUM ('comment', 'status_change', 'system', 'pdf_generated');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "whatsapp_message_log_status_enum" AS ENUM ('sent', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // ------------------------------------------------------------------ //
    // Tabela: subscription_plan
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "subscription_plan" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"        character varying(100) NOT NULL,
        "description" text,
        "max_doctors" integer NOT NULL,
        "is_active"   boolean NOT NULL DEFAULT true,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_plan" PRIMARY KEY ("id")
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: user
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id"                   UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"                 character varying(100) NOT NULL,
        "email"                character varying(100) NOT NULL,
        "password"             character varying(60) NOT NULL,
        "phone"                character varying(15),
        "cpf"                  character varying(14),
        "gender"               character(1),
        "birth_date"           DATE,
        "avatar_url"           character varying(255),
        "role"                 "user_role_enum" NOT NULL DEFAULT 'collaborator',
        "status"               "user_status_enum" NOT NULL DEFAULT 'pending',
        "account_id"           UUID NOT NULL,
        "admin_id"             UUID,
        "subscription_plan_id" UUID,
        "created_at"           TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_email" UNIQUE ("email"),
        CONSTRAINT "PK_user"      PRIMARY KEY ("id")
      );
    `);

    // FKs da tabela user (self-refs + subscription_plan)
    await queryRunner.query(`
      ALTER TABLE "user"
        ADD CONSTRAINT "FK_user_account"
          FOREIGN KEY ("account_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        ADD CONSTRAINT "FK_user_admin"
          FOREIGN KEY ("admin_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        ADD CONSTRAINT "FK_user_subscription_plan"
          FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plan"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    // ------------------------------------------------------------------ //
    // Tabela: doctor_profile
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "doctor_profile" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"         UUID NOT NULL,
        "crm"             character varying(20) NOT NULL,
        "crm_state"       character(2) NOT NULL,
        "specialty"       character varying(100),
        "signature_url"   character varying(255),
        "clinic_name"     character varying(150),
        "clinic_cnpj"     character varying(20),
        "clinic_address"  character varying(255),
        "created_at"      TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_doctor_profile_user_id" UNIQUE ("user_id"),
        CONSTRAINT "PK_doctor_profile"         PRIMARY KEY ("id"),
        CONSTRAINT "FK_doctor_profile_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: user_doctor_access (substitui team_member)
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "user_doctor_access" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"         UUID NOT NULL,
        "doctor_user_id"  UUID NOT NULL,
        "status"          "user_doctor_access_status_enum" NOT NULL DEFAULT 'active',
        "created_by_id"   UUID,
        "created_at"      TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_doctor_access" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_doctor_access" UNIQUE ("user_id", "doctor_user_id"),
        CONSTRAINT "FK_uda_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_uda_doctor_user"
          FOREIGN KEY ("doctor_user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_uda_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: hospital
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "hospital" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"           character varying(150) NOT NULL,
        "cnpj"           character varying(20),
        "email"          character varying(100),
        "phone"          character varying(15),
        "contact_name"   character varying(100),
        "contact_phone"  character varying(15),
        "contact_email"  character varying(100),
        "zip_code"       character varying(10),
        "address"        character varying(200),
        "address_number" character varying(20),
        "neighborhood"   character varying(100),
        "city"           character varying(100),
        "state"          character(2),
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
        "name"                   character varying(150) NOT NULL,
        "ans_code"               character varying(20),
        "cnpj"                   character varying(20),
        "email"                  character varying(100),
        "phone"                  character varying(15),
        "authorization_contact"  character varying(100),
        "authorization_phone"    character varying(15),
        "authorization_email"    character varying(100),
        "website"                character varying(255),
        "portal_url"             character varying(255),
        "default_payment_days"   integer,
        "notes"                  text,
        "active"                 boolean NOT NULL DEFAULT true,
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
        "name"           character varying(150) NOT NULL,
        "cnpj"           character varying(20),
        "email"          character varying(100),
        "phone"          character varying(15),
        "contact_name"   character varying(100),
        "contact_phone"  character varying(15),
        "contact_email"  character varying(100),
        "zip_code"       character varying(10),
        "address"        character varying(200),
        "address_number" character varying(20),
        "neighborhood"   character varying(100),
        "city"           character varying(100),
        "state"          character(2),
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
    // Tabela: procedure
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "procedure" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"       character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_procedure" PRIMARY KEY ("id")
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: patient
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "patient" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"           UUID NOT NULL,
        "name"                character varying(100) NOT NULL,
        "email"               character varying(100) NOT NULL,
        "phone"               character varying(15) NOT NULL,
        "cpf"                 character varying(14),
        "gender"              character(1),
        "birth_date"          DATE,
        "health_plan_id"      UUID,
        "health_plan_number"  character varying(50),
        "health_plan_type"    character varying(100),
        "zip_code"            character varying(10),
        "address"             character varying(200),
        "address_number"      character varying(20),
        "address_complement"  character varying(100),
        "neighborhood"        character varying(100),
        "city"                character varying(100),
        "state"               character(2),
        "medical_notes"       text,
        "active"              boolean NOT NULL DEFAULT true,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient" PRIMARY KEY ("id"),
        CONSTRAINT "FK_patient_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_patient_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plan"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

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
    // Tabela: surgery_request
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request" (
        "id"                       UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"                UUID NOT NULL,
        "created_by_id"            UUID NOT NULL,
        "manager_id"               UUID,
        "patient_id"               UUID NOT NULL,
        "hospital_id"              UUID,
        "health_plan_id"           UUID,
        "procedure_id"             UUID,
        "cid_id"                   character varying(75),
        "status"                   integer NOT NULL DEFAULT 1,
        "protocol"                 character varying(75) DEFAULT generate_protocol(),
        "priority"                 integer NOT NULL DEFAULT 2,
        "deadline"                 TIMESTAMP,
        "has_opme"                 boolean,
        "is_indication"            boolean NOT NULL DEFAULT false,
        "indication_name"          character varying(100),
        "health_plan_registration" character varying(100),
        "health_plan_type"         character varying(100),
        "health_plan_protocol"     character varying(100),
        "diagnosis"                text,
        "medical_report"           text,
        "patient_history"          text,
        "surgery_description"      text,
        "date_options"             jsonb,
        "selected_date_index"      integer,
        "surgery_date"             TIMESTAMP,
        "analysis_started_at"      TIMESTAMP,
        "date_call"                TIMESTAMP,
        "hospital_protocol"        character varying(100),
        "sent_at"                  TIMESTAMP,
        "send_method"              character varying(20),
        "surgery_performed_at"     TIMESTAMP,
        "cancel_reason"            text,
        "closed_at"                TIMESTAMP,
        "created_at"               TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_surgery_request_protocol" UNIQUE ("protocol"),
        CONSTRAINT "PK_surgery_request"          PRIMARY KEY ("id"),
        CONSTRAINT "FK_surgery_request_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
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
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "FK_surgery_request_procedure"
          FOREIGN KEY ("procedure_id") REFERENCES "procedure"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: surgery_request_tuss_item
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request_tuss_item" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "tuss_code"           character varying(50) NOT NULL,
        "name"                character varying(255) NOT NULL,
        "quantity"            integer NOT NULL DEFAULT 1,
        "authorized_quantity" integer,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_tuss_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tuss_item_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
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
        "quantity"            integer NOT NULL DEFAULT 1,
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
    // Tabela: contestation
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
        "id"                       UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"       UUID NOT NULL,
        "request_number"           character varying(100) NOT NULL,
        "received_at"              TIMESTAMP NOT NULL,
        "quotation_1_number"       character varying(100),
        "quotation_1_received_at"  TIMESTAMP,
        "quotation_2_number"       character varying(100),
        "quotation_2_received_at"  TIMESTAMP,
        "quotation_3_number"       character varying(100),
        "quotation_3_received_at"  TIMESTAMP,
        "notes"                    text,
        "created_at"               TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP NOT NULL DEFAULT now(),
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
    // Tabela: surgery_request_activity
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request_activity" (
        "id"                   UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"   UUID NOT NULL,
        "user_id"              UUID,
        "type"                 "activity_type_enum" NOT NULL DEFAULT 'comment',
        "content"              TEXT NOT NULL,
        "created_at"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_activity" PRIMARY KEY ("id"),
        CONSTRAINT "FK_activity_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_activity_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
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
    // FK doctor_id → user.id (corrigido de doctor_profile.id)
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
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_default_document_clinic_created_by"
          FOREIGN KEY ("created_by") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: recovery_code
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

    // ------------------------------------------------------------------ //
    // Tabela: whatsapp_message_log
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "whatsapp_message_log" (
        "id"            UUID NOT NULL DEFAULT uuid_generate_v4(),
        "to"            character varying(20) NOT NULL,
        "body"          text NOT NULL,
        "status"        "whatsapp_message_log_status_enum" NOT NULL DEFAULT 'sent',
        "error_message" text,
        "sent_at"       TIMESTAMPTZ,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_message_log" PRIMARY KEY ("id")
      );
    `);

    // ------------------------------------------------------------------ //
    // Tabela: report_section
    // ------------------------------------------------------------------ //
    await queryRunner.query(`
      CREATE TABLE "report_section" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "title"               character varying(255) NOT NULL,
        "description"         text,
        "order"               integer NOT NULL DEFAULT 0,
        "surgery_request_id"  UUID NOT NULL,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report_section" PRIMARY KEY ("id"),
        CONSTRAINT "FK_report_section_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ------------------------------------------------------------------ //
    // Índices (conforme seção 2.8 do PRD v3)
    // ------------------------------------------------------------------ //

    // user
    await queryRunner.query(
      `CREATE INDEX "idx_user_account_id" ON "user" ("account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_admin_id" ON "user" ("admin_id")`,
    );

    // user_doctor_access
    await queryRunner.query(
      `CREATE INDEX "idx_uda_user_id_status" ON "user_doctor_access" ("user_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_uda_doctor_user_id_status" ON "user_doctor_access" ("doctor_user_id", "status")`,
    );

    // surgery_request
    await queryRunner.query(
      `CREATE INDEX "idx_sr_doctor_id" ON "surgery_request" ("doctor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sr_doctor_id_status" ON "surgery_request" ("doctor_id", "status")`,
    );

    // patient
    await queryRunner.query(
      `CREATE INDEX "idx_patient_doctor_id" ON "patient" ("doctor_id")`,
    );

    // hospital, health_plan, supplier
    await queryRunner.query(
      `CREATE INDEX "idx_hospital_doctor_id" ON "hospital" ("doctor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_health_plan_doctor_id" ON "health_plan" ("doctor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_doctor_id" ON "supplier" ("doctor_id")`,
    );

    // surgery_request_activity
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_surgery_request_id" ON "surgery_request_activity" ("surgery_request_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_created_at" ON "surgery_request_activity" ("created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "report_section"               CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "whatsapp_message_log"          CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "recovery_code"                CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "default_document_clinic"       CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user_notification_settings"    CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "notification"                  CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "chat_message"                  CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "chat"                          CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_activity"      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_template"      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_billing"       CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_analysis"      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "status_update"                 CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "document"                      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "contestation"                  CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_quotation"     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "opme_item"                     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_tuss_item"     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request"               CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "patient"                       CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "procedure"                     CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "supplier"                      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "health_plan"                   CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "hospital"                      CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user_doctor_access"            CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "doctor_profile"                CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user"                          CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "subscription_plan"             CASCADE`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS generate_protocol`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "whatsapp_message_log_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "activity_type_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "user_doctor_access_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "user_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
