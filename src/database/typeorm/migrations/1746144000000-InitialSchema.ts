import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration consolidada v3 — schema completo com tenant isolation reforçado.
 *
 * Mudanças em relação à migration anterior:
 *  - Todas as tabelas agora usam nomes no plural (users, patients, hospitals…)
 *  - `account_id` renomeado para `owner_id` em todas as tabelas
 *  - Tabelas `cid` e `tuss` removidas — dados servidos por JSON estático
 *  - `surgery_requests.cid_id` (FK uuid) substituído por `cid_code` (varchar 10)
 *  - `surgery_requests.tuss_id` removido (dados via surgery_request_tuss_items)
 *  - Tabela `status_update` removida (legado; coberta por surgery_request_activities)
 *  - `documents.created_by` → `documents.created_by_id`
 *  - `default_document_clinics.created_by` → `default_document_clinics.created_by_id`
 *  - `contestations.type` agora enum (authorization | payment)
 *  - `user_notification_settings.user_id` com UNIQUE constraint
 *  - `whatsapp_conversations.account_id` → `owner_id`
 *  - Tenant isolation: hospitals/health_plans/suppliers passam de `doctor_id`
 *    para `owner_id` (cadastros pertencem à clínica). patients,
 *    surgery_requests, surgery_request_templates e default_document_clinics
 *    ganham `owner_id` denormalizado para acelerar filtros por clínica.
 *  - Índices e constraints consistentes
 *  - Higiene de logs: `whatsapp_message_logs` removida (consolidada em
 *    `notification_send_logs`); `whatsapp_conversations.messages_history`
 *    removida (histórico vive em `whatsapp_conversation_messages`);
 *    `notification_send_logs.body` e `error_message` limitados em
 *    VARCHAR(600); `ai_token_usage_logs.phone` substituído por `phone_hash`.
 *
 * Roda fora de transação para permitir `CREATE EXTENSION` (pgvector).
 */
export class InitialSchema1746144000000 implements MigrationInterface {
  name = 'InitialSchema1746144000000';

  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ================================================================ //
    // 1. EXTENSÕES
    // ================================================================ //
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    const vectorAvailable = await queryRunner
      .query(`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`)
      .catch(() => []);

    if (!vectorAvailable.length) {
      throw new Error(
        'Extensão "pgvector" indisponível neste Postgres. ' +
          'Use a imagem `pgvector/pgvector:pg16` ou instale a extensão ' +
          'antes de rodar as migrations. Sem pgvector o RAG não pode ser inicializado.',
      );
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    // ================================================================ //
    // 2. ENUMS
    // ================================================================ //
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('admin', 'collaborator');
    `);

    await queryRunner.query(`
      CREATE TYPE "user_status_enum" AS ENUM ('pending', 'active', 'inactive');
    `);

    await queryRunner.query(`
      CREATE TYPE "user_doctor_access_status_enum" AS ENUM ('active', 'inactive');
    `);

    await queryRunner.query(`
      CREATE TYPE "activity_type_enum" AS ENUM (
        'comment', 'status_change', 'system', 'pdf_generated'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_type_enum" AS ENUM (
        'new_surgery_request',
        'status_update',
        'pendency',
        'expiring_document',
        'action_by_user',
        'system',
        'info'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "doctor_header_logo_position_enum" AS ENUM ('left', 'right');
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_channel_enum" AS ENUM ('email', 'whatsapp');
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_send_status_enum" AS ENUM (
        'queued', 'sent', 'delivered', 'read', 'failed'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "contestation_type_enum" AS ENUM ('authorization', 'payment');
    `);

    // ================================================================ //
    // 3. FUNÇÕES UTILITÁRIAS
    // ================================================================ //
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION generate_protocol()
      RETURNS VARCHAR AS $$
      DECLARE
        new_protocol VARCHAR;
        protocol_exists BOOLEAN;
        attempts INTEGER := 0;
        max_attempts CONSTANT INTEGER := 100;
      BEGIN
        LOOP
          attempts := attempts + 1;
          IF attempts > max_attempts THEN
            RAISE EXCEPTION
              'generate_protocol: não foi possível gerar protocolo único após % tentativas',
              max_attempts;
          END IF;

          new_protocol := LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0');
          SELECT EXISTS(
            SELECT 1 FROM surgery_requests WHERE protocol = new_protocol
          ) INTO protocol_exists;

          IF NOT protocol_exists THEN
            RETURN new_protocol;
          END IF;
        END LOOP;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ================================================================ //
    // 4. TABELAS BASE (sem dependências externas)
    // ================================================================ //

    // ---------- subscription_plans ----------
    await queryRunner.query(`
      CREATE TABLE "subscription_plans" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"        VARCHAR(100) NOT NULL,
        "description" TEXT,
        "max_doctors" INTEGER NOT NULL,
        "is_active"   BOOLEAN NOT NULL DEFAULT true,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_subscription_plans" PRIMARY KEY ("id")
      );
    `);

    // ---------- procedures ----------
    await queryRunner.query(`
      CREATE TABLE "procedures" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"       VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_procedures" PRIMARY KEY ("id")
      );
    `);

    // ================================================================ //
    // 5. TABELA "users" (auto-referenciada via owner_id e admin_id)
    // ================================================================ //
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"                            VARCHAR(100) NOT NULL,
        "email"                           VARCHAR(160) NOT NULL,
        "password"                        VARCHAR(60),
        "phone"                           VARCHAR(15),
        "cpf"                             VARCHAR(14),
        "gender"                          CHAR(1),
        "birth_date"                      DATE,
        "avatar_url"                      VARCHAR(255),
        "role"                            "user_role_enum" NOT NULL DEFAULT 'collaborator',
        "status"                          "user_status_enum" NOT NULL DEFAULT 'pending',
        "owner_id"                        UUID NOT NULL,
        "admin_id"                        UUID,
        "subscription_plan_id"            UUID,
        "cep"                             VARCHAR(9),
        "address"                         VARCHAR(200),
        "address_number"                  VARCHAR(10),
        "address_complement"              VARCHAR(100),
        "city"                            VARCHAR(100),
        "state"                           VARCHAR(2),
        "email_verified"                  BOOLEAN NOT NULL DEFAULT false,
        "email_verified_at"               TIMESTAMP,
        "email_verification_token"        VARCHAR(128),
        "email_verification_expires_at"   TIMESTAMP,
        "ai_consent_at"                   TIMESTAMPTZ,
        "ai_consent_version"              VARCHAR(20),
        "privacy_policy_consent_at"       TIMESTAMPTZ,
        "privacy_policy_consent_version"  VARCHAR(20),
        "terms_of_use_consent_at"         TIMESTAMPTZ,
        "terms_of_use_consent_version"    VARCHAR(20),
        "deleted_at"                      TIMESTAMP,
        "created_at"                      TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"                      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users"       PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "fk_users_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        ADD CONSTRAINT "fk_users_admin"
          FOREIGN KEY ("admin_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        ADD CONSTRAINT "fk_users_subscription_plan"
          FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_users_owner_id"   ON "users" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_admin_id"   ON "users" ("admin_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_deleted_at" ON "users" ("deleted_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_email_verification_token" ON "users" ("email_verification_token") WHERE "email_verification_token" IS NOT NULL;`,
    );

    // ================================================================ //
    // 6. AUTENTICAÇÃO E PERFIL
    // ================================================================ //

    // ---------- refresh_tokens ----------
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "token"      VARCHAR(512) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "revoked"    BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "uq_refresh_tokens_token" UNIQUE ("token"),
        CONSTRAINT "fk_refresh_tokens_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_revoked" ON "refresh_tokens" ("revoked");`,
    );

    // ---------- recovery_codes ----------
    await queryRunner.query(`
      CREATE TABLE "recovery_codes" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "code"       VARCHAR(6) NOT NULL,
        "expires_at" TIMESTAMP,
        "used"       BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_recovery_codes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_recovery_codes_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_recovery_codes_user_id" ON "recovery_codes" ("user_id");`,
    );

    // ---------- doctor_profiles ----------
    await queryRunner.query(`
      CREATE TABLE "doctor_profiles" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"        UUID NOT NULL,
        "crm"            VARCHAR(20) NOT NULL,
        "crm_state"      CHAR(2) NOT NULL,
        "specialty"      VARCHAR(100),
        "signature_url"  VARCHAR(255),
        "clinic_name"    VARCHAR(150),
        "clinic_cnpj"    VARCHAR(20),
        "clinic_address" VARCHAR(255),
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_doctor_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "uq_doctor_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_doctor_profiles_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- doctor_headers ----------
    await queryRunner.query(`
      CREATE TABLE "doctor_headers" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_profile_id" UUID NOT NULL,
        "logo_url"          VARCHAR(500),
        "logo_position"     "doctor_header_logo_position_enum" NOT NULL DEFAULT 'left',
        "content_html"      TEXT,
        "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_doctor_headers" PRIMARY KEY ("id"),
        CONSTRAINT "uq_doctor_headers_profile" UNIQUE ("doctor_profile_id"),
        CONSTRAINT "fk_doctor_headers_profile"
          FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- user_doctor_accesses ----------
    await queryRunner.query(`
      CREATE TABLE "user_doctor_accesses" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"        UUID NOT NULL,
        "doctor_user_id" UUID NOT NULL,
        "status"         "user_doctor_access_status_enum" NOT NULL DEFAULT 'active',
        "created_by_id"  UUID,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_doctor_accesses" PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_doctor_accesses_user_doctor" UNIQUE ("user_id", "doctor_user_id"),
        CONSTRAINT "fk_user_doctor_accesses_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_user_doctor_accesses_doctor"
          FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_user_doctor_accesses_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_uda_user_status"   ON "user_doctor_accesses" ("user_id", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_uda_doctor_status" ON "user_doctor_accesses" ("doctor_user_id", "status");`,
    );

    // ================================================================ //
    // 7. ENTIDADES DE NEGÓCIO
    // ================================================================ //

    // ---------- hospitals ----------
    await queryRunner.query(`
      CREATE TABLE "hospitals" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"           VARCHAR(150) NOT NULL,
        "cnpj"           VARCHAR(20),
        "email"          VARCHAR(100),
        "phone"          VARCHAR(15),
        "contact_name"   VARCHAR(100),
        "contact_phone"  VARCHAR(15),
        "contact_email"  VARCHAR(100),
        "zip_code"       VARCHAR(10),
        "address"        VARCHAR(200),
        "address_number" VARCHAR(20),
        "neighborhood"   VARCHAR(100),
        "city"           VARCHAR(100),
        "state"          CHAR(2),
        "active"         BOOLEAN NOT NULL DEFAULT true,
        "owner_id"       UUID NOT NULL,
        "deleted_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_hospitals" PRIMARY KEY ("id"),
        CONSTRAINT "fk_hospitals_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_hospitals_owner_id"   ON "hospitals" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hospitals_deleted_at" ON "hospitals" ("deleted_at");`,
    );

    // ---------- health_plans ----------
    await queryRunner.query(`
      CREATE TABLE "health_plans" (
        "id"                    UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"                  VARCHAR(150) NOT NULL,
        "ans_code"              VARCHAR(20),
        "cnpj"                  VARCHAR(20),
        "email"                 VARCHAR(100),
        "phone"                 VARCHAR(15),
        "authorization_contact" VARCHAR(100),
        "authorization_phone"   VARCHAR(15),
        "authorization_email"   VARCHAR(100),
        "website"               VARCHAR(255),
        "portal_url"            VARCHAR(255),
        "default_payment_days"  INTEGER,
        "notes"                 TEXT,
        "active"                BOOLEAN NOT NULL DEFAULT true,
        "owner_id"              UUID NOT NULL,
        "deleted_at"            TIMESTAMP,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_health_plans" PRIMARY KEY ("id"),
        CONSTRAINT "fk_health_plans_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_health_plans_owner_id"   ON "health_plans" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_health_plans_deleted_at" ON "health_plans" ("deleted_at");`,
    );

    // ---------- suppliers ----------
    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"           VARCHAR(150) NOT NULL,
        "cnpj"           VARCHAR(20),
        "email"          VARCHAR(100),
        "phone"          VARCHAR(15),
        "contact_name"   VARCHAR(100),
        "contact_phone"  VARCHAR(15),
        "contact_email"  VARCHAR(100),
        "zip_code"       VARCHAR(10),
        "address"        VARCHAR(200),
        "address_number" VARCHAR(20),
        "neighborhood"   VARCHAR(100),
        "city"           VARCHAR(100),
        "state"          CHAR(2),
        "website"        VARCHAR(200),
        "category"       VARCHAR(50),
        "payment_terms"  VARCHAR(50),
        "delivery_time"  VARCHAR(100),
        "notes"          TEXT,
        "active"         BOOLEAN NOT NULL DEFAULT true,
        "owner_id"       UUID NOT NULL,
        "deleted_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "fk_suppliers_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_suppliers_owner_id"   ON "suppliers" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_suppliers_deleted_at" ON "suppliers" ("deleted_at");`,
    );

    // ---------- patients ----------
    await queryRunner.query(`
      CREATE TABLE "patients" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"          UUID NOT NULL,
        "owner_id"           UUID NOT NULL,
        "name"               VARCHAR(100) NOT NULL,
        "email"              VARCHAR(100) NOT NULL,
        "phone"              VARCHAR(15) NOT NULL,
        "cpf"                VARCHAR(14),
        "gender"             CHAR(1),
        "birth_date"         DATE,
        "health_plan_id"     UUID,
        "health_plan_number" VARCHAR(50),
        "health_plan_type"   VARCHAR(100),
        "zip_code"           VARCHAR(10),
        "address"            VARCHAR(200),
        "address_number"     VARCHAR(20),
        "address_complement" VARCHAR(100),
        "neighborhood"       VARCHAR(100),
        "city"               VARCHAR(100),
        "state"              CHAR(2),
        "medical_notes"      TEXT,
        "active"             BOOLEAN NOT NULL DEFAULT true,
        "deleted_at"         TIMESTAMP,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_patients" PRIMARY KEY ("id"),
        CONSTRAINT "fk_patients_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_patients_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_patients_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_patients_doctor_id"  ON "patients" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patients_owner_id"   ON "patients" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patients_deleted_at" ON "patients" ("deleted_at");`,
    );

    // ================================================================ //
    // 8. SOLICITAÇÃO CIRÚRGICA
    // ================================================================ //
    await queryRunner.query(`
      CREATE TABLE "surgery_requests" (
        "id"                       UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- surgery_request_tuss_items ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_tuss_items" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- opme_items ----------
    await queryRunner.query(`
      CREATE TABLE "opme_items" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- opme_item_suppliers (junction) ----------
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

    // ---------- surgery_request_quotations ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_quotations" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- contestations ----------
    await queryRunner.query(`
      CREATE TABLE "contestations" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- documents ----------
    await queryRunner.query(`
      CREATE TABLE "documents" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- surgery_request_analyses ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_analyses" (
        "id"                      UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- surgery_request_billings ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_billings" (
        "id"                       UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- surgery_request_templates ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_templates" (
        "id"            UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- surgery_request_activities ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_activities" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- chats ----------
    await queryRunner.query(`
      CREATE TABLE "chats" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "user_id"            UUID NOT NULL,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_chats" PRIMARY KEY ("id"),
        CONSTRAINT "fk_chats_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_requests"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_chats_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_chats_sr_id" ON "chats" ("surgery_request_id");`,
    );

    // ---------- chat_messages ----------
    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "chat_id"    UUID NOT NULL,
        "sender_id"  UUID NOT NULL,
        "read"       BOOLEAN NOT NULL DEFAULT false,
        "message"    TEXT NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "fk_chat_messages_chat"
          FOREIGN KEY ("chat_id") REFERENCES "chats"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_chat_messages_sender"
          FOREIGN KEY ("sender_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_chat_messages_chat_id" ON "chat_messages" ("chat_id");`,
    );

    // ---------- notifications ----------
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "type"       "notification_type_enum" NOT NULL DEFAULT 'info',
        "title"      VARCHAR(255) NOT NULL,
        "message"    TEXT NOT NULL,
        "read"       BOOLEAN NOT NULL DEFAULT false,
        "link"       VARCHAR(255),
        "metadata"   JSONB,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "fk_notifications_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_user_read" ON "notifications" ("user_id", "read");`,
    );

    // ---------- user_notification_settings ----------
    await queryRunner.query(`
      CREATE TABLE "user_notification_settings" (
        "id"                     UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"                UUID NOT NULL,
        "email_notifications"    BOOLEAN NOT NULL DEFAULT true,
        "sms_notifications"      BOOLEAN NOT NULL DEFAULT false,
        "push_notifications"     BOOLEAN NOT NULL DEFAULT true,
        "whatsapp_notifications" BOOLEAN NOT NULL DEFAULT true,
        "new_surgery_request"    BOOLEAN NOT NULL DEFAULT true,
        "status_update"          BOOLEAN NOT NULL DEFAULT true,
        "pendencies"             BOOLEAN NOT NULL DEFAULT true,
        "expiring_documents"     BOOLEAN NOT NULL DEFAULT true,
        "weekly_report"          BOOLEAN NOT NULL DEFAULT false,
        "created_at"             TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"             TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_notification_settings" PRIMARY KEY ("id"),
        CONSTRAINT "uq_uns_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_uns_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- default_document_clinics ----------
    await queryRunner.query(`
      CREATE TABLE "default_document_clinics" (
        "id"            UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"     UUID NOT NULL,
        "owner_id"      UUID NOT NULL,
        "created_by_id" UUID NOT NULL,
        "key"           VARCHAR(50) NOT NULL,
        "name"          VARCHAR(100) NOT NULL,
        "file_url"      VARCHAR(255),
        "description"   TEXT,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_default_document_clinics" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ddc_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_ddc_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_ddc_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ddc_doctor_id" ON "default_document_clinics" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ddc_owner_id"  ON "default_document_clinics" ("owner_id");`,
    );

    // ---------- report_sections ----------
    await queryRunner.query(`
      CREATE TABLE "report_sections" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ---------- stale_notification_logs ----------
    await queryRunner.query(`
      CREATE TABLE "stale_notification_logs" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
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

    // ================================================================ //
    // 9. WHATSAPP / IA CONVERSAÇÃO
    // ================================================================ //

    // ---------- whatsapp_conversations ----------
    // Histórico bruto vive em `whatsapp_conversation_messages` (1 linha por mensagem).
    // Não há mais coluna `messages_history` JSONB monolítica (eliminada para reduzir I/O).
    await queryRunner.query(`
      CREATE TABLE "whatsapp_conversations" (
        "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
        "phone"                VARCHAR(20) NOT NULL,
        "user_id"              UUID,
        "owner_id"             UUID,
        "conversation_summary" TEXT,
        "conversation_memory"  JSONB NOT NULL DEFAULT '{}'::jsonb,
        "summary_updated_at"   TIMESTAMPTZ,
        "summary_version"      INTEGER NOT NULL DEFAULT 1,
        "started_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_message_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "active"               BOOLEAN NOT NULL DEFAULT true,
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_whatsapp_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_wc_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_wc_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_wc_phone"       ON "whatsapp_conversations" ("phone");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wc_active"      ON "whatsapp_conversations" ("active", "last_message_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wc_owner"       ON "whatsapp_conversations" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wc_phone_active"
         ON "whatsapp_conversations" ("phone")
         WHERE "active" = true;`,
    );

    // ---------- whatsapp_conversation_messages ----------
    await queryRunner.query(`
      CREATE TABLE "whatsapp_conversation_messages" (
        "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" UUID NOT NULL,
        "role"            VARCHAR(20) NOT NULL,
        "content"         TEXT NOT NULL,
        "tool_name"       VARCHAR(100),
        "metadata"        JSONB,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_whatsapp_conversation_messages" PRIMARY KEY ("id"),
        CONSTRAINT "fk_wcm_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_wcm_conversation_created" ON "whatsapp_conversation_messages" ("conversation_id", "created_at");`,
    );

    // ---------- notification_send_logs ----------
    // Tabela única de auditoria de envio (e-mail + WhatsApp). Substitui a antiga
    // `whatsapp_message_logs` (descontinuada). `body` e `error_message` são
    // limitados em VARCHAR(600) para manter os logs enxutos no DB —
    // truncagem é aplicada na escrita por `truncateForLog`.
    await queryRunner.query(`
      CREATE TABLE "notification_send_logs" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "channel"           "notification_channel_enum" NOT NULL,
        "status"            "notification_send_status_enum" NOT NULL DEFAULT 'queued',
        "to"                VARCHAR(255) NOT NULL,
        "subject"           VARCHAR(255),
        "template"          VARCHAR(100),
        "body"              VARCHAR(600),
        "error_message"     VARCHAR(600),
        "job_id"            VARCHAR(100),
        "attempts"          INTEGER NOT NULL DEFAULT 0,
        "sent_at"           TIMESTAMPTZ,
        "message_sid"       VARCHAR(64),
        "user_id"           UUID,
        "conversation_id"   UUID,
        "owner_id"          UUID,
        "direction"         VARCHAR(10) DEFAULT 'outbound',
        "notification_type" VARCHAR(20) DEFAULT 'freeform',
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_send_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_nsl_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_nsl_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_nsl_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_channel_status" ON "notification_send_logs" ("channel", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_created_at"     ON "notification_send_logs" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_owner"          ON "notification_send_logs" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_owner_created"  ON "notification_send_logs" ("owner_id", "created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_message_sid"    ON "notification_send_logs" ("message_sid");`,
    );

    // ================================================================ //
    // 10. IA — RAG, TOKENS, PII E CONSENTIMENTOS
    // ================================================================ //

    // ---------- ai_knowledge_chunks ----------
    await queryRunner.query(`
      CREATE TABLE "ai_knowledge_chunks" (
        "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
        "category"   VARCHAR(50) NOT NULL,
        "title"      TEXT NOT NULL,
        "content"    TEXT NOT NULL,
        "metadata"   JSONB,
        "embedding"  vector(1536),
        "active"     BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_knowledge_chunks" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_knowledge_category_active" ON "ai_knowledge_chunks" ("category", "active");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_knowledge_embedding"
         ON "ai_knowledge_chunks"
         USING ivfflat ("embedding" vector_cosine_ops)
         WITH (lists = 100);`,
    );

    // ---------- ai_token_usage_logs ----------
    // `phone_hash` (hex) substitui o telefone em claro. Não é PII e permite
    // agrupar uso por usuário sem armazenar identificador clínico.
    await queryRunner.query(`
      CREATE TABLE "ai_token_usage_logs" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "message_sid"         VARCHAR(64) NOT NULL,
        "phone_hash"          VARCHAR(64) NOT NULL,
        "user_id"             UUID,
        "conversation_id"     UUID,
        "owner_id"            UUID,
        "prompt_tokens"       INTEGER NOT NULL DEFAULT 0,
        "completion_tokens"   INTEGER NOT NULL DEFAULT 0,
        "total_tokens"        INTEGER NOT NULL DEFAULT 0,
        "calls_count"         INTEGER NOT NULL DEFAULT 0,
        "model"               VARCHAR(50),
        "latency_ms"          INTEGER,
        "cost_estimate_cents" INTEGER,
        "breakdown"           JSONB NOT NULL DEFAULT '[]'::jsonb,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_token_usage_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_token_logs_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_ai_token_logs_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_ai_token_logs_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_message_sid"             ON "ai_token_usage_logs" ("message_sid");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_conversation_created_at" ON "ai_token_usage_logs" ("conversation_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_user_created_at"         ON "ai_token_usage_logs" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_created_at"              ON "ai_token_usage_logs" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_owner"                   ON "ai_token_usage_logs" ("owner_id");`,
    );

    // ---------- ai_pii_redaction_logs ----------
    await queryRunner.query(`
      CREATE TABLE "ai_pii_redaction_logs" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" UUID,
        "message_sid"     VARCHAR(64),
        "category"        VARCHAR(40) NOT NULL,
        "value_hash"      VARCHAR(64) NOT NULL,
        "blocked"         BOOLEAN NOT NULL DEFAULT false,
        "tool_name"       VARCHAR(100),
        "occurrences"     INTEGER NOT NULL DEFAULT 1,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_pii_redaction_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_pii_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ai_pii_category_created" ON "ai_pii_redaction_logs" ("category", "created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_pii_conversation"     ON "ai_pii_redaction_logs" ("conversation_id");`,
    );

    // ---------- consent_logs (LGPD) ----------
    await queryRunner.query(`
      CREATE TABLE "consent_logs" (
        "id"           UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"      UUID NOT NULL,
        "consent_type" VARCHAR(40) NOT NULL,
        "version"      VARCHAR(20) NOT NULL,
        "action"       VARCHAR(20) NOT NULL,
        "ip_address"   VARCHAR(45),
        "user_agent"   TEXT,
        "channel"      VARCHAR(20) NOT NULL DEFAULT 'web',
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_consent_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_consent_logs_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_consent_logs_user_type_created" ON "consent_logs" ("user_id", "consent_type", "created_at" DESC);`,
    );

    // ---------- conversation_cleanup_log ----------
    await queryRunner.query(`
      CREATE TABLE "conversation_cleanup_log" (
        "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
        "deleted_count" INTEGER NOT NULL DEFAULT 0,
        "cutoff_date"   TIMESTAMPTZ NOT NULL,
        "executed_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_conversation_cleanup_log" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_cleanup_log_executed" ON "conversation_cleanup_log" ("executed_at" DESC);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'conversation_cleanup_log',
      'consent_logs',
      'ai_pii_redaction_logs',
      'ai_token_usage_logs',
      'ai_knowledge_chunks',
      'notification_send_logs',
      'whatsapp_conversation_messages',
      'whatsapp_conversations',
      'stale_notification_logs',
      'report_sections',
      'default_document_clinics',
      'user_notification_settings',
      'notifications',
      'chat_messages',
      'chats',
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
      'surgery_requests',
      'patients',
      'suppliers',
      'health_plans',
      'hospitals',
      'user_doctor_accesses',
      'doctor_headers',
      'doctor_profiles',
      'recovery_codes',
      'refresh_tokens',
      'procedures',
      'users',
      'subscription_plans',
    ];

    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }

    await queryRunner.query(`DROP FUNCTION IF EXISTS generate_protocol;`);

    const enums = [
      'contestation_type_enum',
      'notification_send_status_enum',
      'notification_channel_enum',
      'doctor_header_logo_position_enum',
      'notification_type_enum',
      'activity_type_enum',
      'user_doctor_access_status_enum',
      'user_status_enum',
      'user_role_enum',
    ];
    for (const enumName of enums) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${enumName}";`);
    }

    await queryRunner.query(`DROP EXTENSION IF EXISTS "vector";`);
  }
}
