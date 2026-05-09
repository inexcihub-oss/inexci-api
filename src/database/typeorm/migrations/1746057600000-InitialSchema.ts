import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration consolidada — schema completo do sistema InExci.
 *
 * Esta migration substitui todas as anteriores e cria o schema final
 * alinhado com as entidades em `src/database/entities/*`. Foi escrita
 * para rodar em base nova (greenfield).
 *
 * Correções aplicadas em relação ao histórico anterior:
 *  - `ai_knowledge_chunk` é criada nesta migration (não fica órfã antes
 *    de quaisquer índices/ALTERs).
 *  - Enums já criados com TODOS os valores finais (sem `ALTER TYPE
 *    ADD VALUE` em runtime, evitando o problema de uso de novo valor
 *    na mesma transação).
 *  - `whatsapp_message_log` permanece com nome canônico (entity
 *    correspondente continua funcional) e já contém todas as colunas
 *    de observabilidade/multi-tenant.
 *  - `user_doctor_access` ganha `UNIQUE (user_id, doctor_user_id)`.
 *  - `account_id` em todas as tabelas multi-tenant tem FK para `user`.
 *  - Função `generate_protocol()` com limite de tentativas (não é mais
 *    LOOP infinito).
 *  - Convenção uniforme de nomes: `pk_*`, `fk_*`, `uq_*`, `idx_*`.
 *  - Remoção de índices duplicados.
 *  - `notification.type` criado como enum (alinhado com a entity).
 *  - `surgery_request.status` / `priority` como `smallint`.
 *
 * Roda fora de transação para permitir `CREATE EXTENSION` (pgvector).
 */
export class InitialSchema1746057600000 implements MigrationInterface {
  name = 'InitialSchema1746057600000';

  // CREATE EXTENSION exige rodar fora de transação.
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
      CREATE TYPE "whatsapp_message_log_status_enum" AS ENUM (
        'queued', 'sent', 'delivered', 'read', 'failed'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_channel_enum" AS ENUM ('email', 'whatsapp');
    `);

    await queryRunner.query(`
      CREATE TYPE "notification_send_status_enum" AS ENUM (
        'queued', 'sent', 'delivered', 'read', 'failed'
      );
    `);

    // ================================================================ //
    // 3. FUNÇÕES UTILITÁRIAS
    // ================================================================ //
    // Gera protocolo de 6 dígitos único com limite de tentativas.
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
            SELECT 1 FROM surgery_request WHERE protocol = new_protocol
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

    // ---------- subscription_plan ----------
    await queryRunner.query(`
      CREATE TABLE "subscription_plan" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"        VARCHAR(100) NOT NULL,
        "description" TEXT,
        "max_doctors" INTEGER NOT NULL,
        "is_active"   BOOLEAN NOT NULL DEFAULT true,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_subscription_plan" PRIMARY KEY ("id")
      );
    `);

    // ---------- procedure ----------
    await queryRunner.query(`
      CREATE TABLE "procedure" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"       VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_procedure" PRIMARY KEY ("id")
      );
    `);

    // ---------- cid ----------
    await queryRunner.query(`
      CREATE TABLE "cid" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "code"        VARCHAR(10) NOT NULL,
        "description" VARCHAR(500) NOT NULL,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_cid" PRIMARY KEY ("id"),
        CONSTRAINT "uq_cid_code" UNIQUE ("code")
      );
    `);
    await queryRunner.query(`CREATE INDEX "idx_cid_code" ON "cid" ("code");`);

    // ---------- tuss ----------
    await queryRunner.query(`
      CREATE TABLE "tuss" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "code"       VARCHAR(20) NOT NULL,
        "procedure"  VARCHAR(500) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tuss" PRIMARY KEY ("id"),
        CONSTRAINT "uq_tuss_code" UNIQUE ("code")
      );
    `);
    await queryRunner.query(`CREATE INDEX "idx_tuss_code" ON "tuss" ("code");`);

    // ================================================================ //
    // 5. TABELA "user" (auto-referenciada via account_id e admin_id)
    // ================================================================ //
    await queryRunner.query(`
      CREATE TABLE "user" (
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
        "account_id"                      UUID NOT NULL,
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
        CONSTRAINT "pk_user"      PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_email" UNIQUE ("email")
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "user"
        ADD CONSTRAINT "fk_user_account"
          FOREIGN KEY ("account_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        ADD CONSTRAINT "fk_user_admin"
          FOREIGN KEY ("admin_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        ADD CONSTRAINT "fk_user_subscription_plan"
          FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plan"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_user_account_id" ON "user" ("account_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_admin_id"   ON "user" ("admin_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_deleted_at" ON "user" ("deleted_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_email_verification_token" ON "user" ("email_verification_token") WHERE "email_verification_token" IS NOT NULL;`,
    );

    // ================================================================ //
    // 6. AUTENTICAÇÃO E PERFIL
    // ================================================================ //

    // ---------- refresh_token ----------
    await queryRunner.query(`
      CREATE TABLE "refresh_token" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "token"      VARCHAR(512) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "revoked"    BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_refresh_token" PRIMARY KEY ("id"),
        CONSTRAINT "uq_refresh_token_token" UNIQUE ("token"),
        CONSTRAINT "fk_refresh_token_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_token_user_id" ON "refresh_token" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_token_revoked" ON "refresh_token" ("revoked");`,
    );

    // ---------- recovery_code ----------
    await queryRunner.query(`
      CREATE TABLE "recovery_code" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"    UUID NOT NULL,
        "code"       VARCHAR(6) NOT NULL,
        "expires_at" TIMESTAMP,
        "used"       BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_recovery_code" PRIMARY KEY ("id"),
        CONSTRAINT "fk_recovery_code_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_recovery_code_user_id" ON "recovery_code" ("user_id");`,
    );

    // ---------- doctor_profile ----------
    await queryRunner.query(`
      CREATE TABLE "doctor_profile" (
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
        CONSTRAINT "pk_doctor_profile" PRIMARY KEY ("id"),
        CONSTRAINT "uq_doctor_profile_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_doctor_profile_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- doctor_header ----------
    await queryRunner.query(`
      CREATE TABLE "doctor_header" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_profile_id" UUID NOT NULL,
        "logo_url"          VARCHAR(500),
        "logo_position"     "doctor_header_logo_position_enum" NOT NULL DEFAULT 'left',
        "content_html"      TEXT,
        "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_doctor_header" PRIMARY KEY ("id"),
        CONSTRAINT "uq_doctor_header_profile" UNIQUE ("doctor_profile_id"),
        CONSTRAINT "fk_doctor_header_profile"
          FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profile"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- user_doctor_access ----------
    await queryRunner.query(`
      CREATE TABLE "user_doctor_access" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"        UUID NOT NULL,
        "doctor_user_id" UUID NOT NULL,
        "status"         "user_doctor_access_status_enum" NOT NULL DEFAULT 'active',
        "created_by_id"  UUID,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_doctor_access" PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_doctor_access_user_doctor" UNIQUE ("user_id", "doctor_user_id"),
        CONSTRAINT "fk_user_doctor_access_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_user_doctor_access_doctor"
          FOREIGN KEY ("doctor_user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_user_doctor_access_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_user_doctor_access_user_status"   ON "user_doctor_access" ("user_id", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_doctor_access_doctor_status" ON "user_doctor_access" ("doctor_user_id", "status");`,
    );

    // ================================================================ //
    // 7. ENTIDADES DE NEGÓCIO
    // ================================================================ //

    // ---------- hospital ----------
    await queryRunner.query(`
      CREATE TABLE "hospital" (
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
        "doctor_id"      UUID NOT NULL,
        "deleted_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_hospital" PRIMARY KEY ("id"),
        CONSTRAINT "fk_hospital_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_hospital_doctor_id"  ON "hospital" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hospital_deleted_at" ON "hospital" ("deleted_at");`,
    );

    // ---------- health_plan ----------
    await queryRunner.query(`
      CREATE TABLE "health_plan" (
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
        "doctor_id"             UUID NOT NULL,
        "deleted_at"            TIMESTAMP,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_health_plan" PRIMARY KEY ("id"),
        CONSTRAINT "fk_health_plan_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_health_plan_doctor_id"  ON "health_plan" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_health_plan_deleted_at" ON "health_plan" ("deleted_at");`,
    );

    // ---------- supplier ----------
    await queryRunner.query(`
      CREATE TABLE "supplier" (
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
        "doctor_id"      UUID NOT NULL,
        "deleted_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_supplier" PRIMARY KEY ("id"),
        CONSTRAINT "fk_supplier_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_doctor_id"  ON "supplier" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_deleted_at" ON "supplier" ("deleted_at");`,
    );

    // ---------- patient ----------
    await queryRunner.query(`
      CREATE TABLE "patient" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"          UUID NOT NULL,
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
        CONSTRAINT "pk_patient" PRIMARY KEY ("id"),
        CONSTRAINT "fk_patient_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_patient_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plan"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_patient_doctor_id"  ON "patient" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patient_deleted_at" ON "patient" ("deleted_at");`,
    );

    // ================================================================ //
    // 8. SOLICITAÇÃO CIRÚRGICA
    // ================================================================ //
    await queryRunner.query(`
      CREATE TABLE "surgery_request" (
        "id"                       UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"                UUID NOT NULL,
        "created_by_id"            UUID NOT NULL,
        "patient_id"               UUID NOT NULL,
        "hospital_id"              UUID,
        "health_plan_id"           UUID,
        "procedure_id"             UUID,
        "cid_id"                   UUID,
        "tuss_id"                  UUID,
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
        CONSTRAINT "pk_surgery_request" PRIMARY KEY ("id"),
        CONSTRAINT "uq_surgery_request_protocol" UNIQUE ("protocol"),
        CONSTRAINT "fk_surgery_request_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_request_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_request_patient"
          FOREIGN KEY ("patient_id") REFERENCES "patient"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_request_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospital"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_request_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plan"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_request_procedure"
          FOREIGN KEY ("procedure_id") REFERENCES "procedure"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_request_cid"
          FOREIGN KEY ("cid_id") REFERENCES "cid"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_surgery_request_tuss"
          FOREIGN KEY ("tuss_id") REFERENCES "tuss"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_doctor_id"        ON "surgery_request" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_doctor_status"    ON "surgery_request" ("doctor_id", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_status"           ON "surgery_request" ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_created_at"       ON "surgery_request" ("created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_health_plan_id"   ON "surgery_request" ("health_plan_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_hospital_id"      ON "surgery_request" ("hospital_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_patient_id"       ON "surgery_request" ("patient_id");`,
    );

    // ---------- surgery_request_tuss_item ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_tuss_item" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "tuss_code"           VARCHAR(50) NOT NULL,
        "name"                VARCHAR(255) NOT NULL,
        "quantity"            INTEGER NOT NULL DEFAULT 1,
        "authorized_quantity" INTEGER,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_tuss_item" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tuss_item_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_tuss_item_surgery_request_id" ON "surgery_request_tuss_item" ("surgery_request_id");`,
    );

    // ---------- opme_item ----------
    await queryRunner.query(`
      CREATE TABLE "opme_item" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"  UUID NOT NULL,
        "name"                VARCHAR(75) NOT NULL,
        "brand"               VARCHAR(75),
        "quantity"            INTEGER NOT NULL DEFAULT 1,
        "authorized_quantity" INTEGER,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_opme_item" PRIMARY KEY ("id"),
        CONSTRAINT "fk_opme_item_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_opme_item_surgery_request_id" ON "opme_item" ("surgery_request_id");`,
    );

    // ---------- opme_item_supplier (junction) ----------
    await queryRunner.query(`
      CREATE TABLE "opme_item_supplier" (
        "opme_item_id" UUID NOT NULL,
        "supplier_id"  UUID NOT NULL,
        CONSTRAINT "pk_opme_item_supplier" PRIMARY KEY ("opme_item_id", "supplier_id"),
        CONSTRAINT "fk_opme_item_supplier_opme_item"
          FOREIGN KEY ("opme_item_id") REFERENCES "opme_item"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_opme_item_supplier_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- surgery_request_quotation ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_quotation" (
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
        CONSTRAINT "pk_surgery_request_quotation" PRIMARY KEY ("id"),
        CONSTRAINT "fk_quotation_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_quotation_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_quotation_surgery_request_id" ON "surgery_request_quotation" ("surgery_request_id");`,
    );

    // ---------- contestation ----------
    await queryRunner.query(`
      CREATE TABLE "contestation" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "created_by_id"      UUID NOT NULL,
        "type"               VARCHAR(50) NOT NULL,
        "reason"             TEXT NOT NULL,
        "resolved_at"        TIMESTAMP,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contestation" PRIMARY KEY ("id"),
        CONSTRAINT "fk_contestation_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_contestation_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_contestation_surgery_request_id" ON "contestation" ("surgery_request_id");`,
    );

    // ---------- document ----------
    await queryRunner.query(`
      CREATE TABLE "document" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "created_by"         UUID NOT NULL,
        "type"               VARCHAR(75) NOT NULL DEFAULT 'additional_document',
        "key"                VARCHAR(50) NOT NULL,
        "name"               VARCHAR(75) NOT NULL,
        "uri"                VARCHAR(255),
        "contestation_id"    UUID,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_document" PRIMARY KEY ("id"),
        CONSTRAINT "fk_document_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_document_user"
          FOREIGN KEY ("created_by") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_document_contestation"
          FOREIGN KEY ("contestation_id") REFERENCES "contestation"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_document_surgery_request_id" ON "document" ("surgery_request_id");`,
    );

    // ---------- status_update ----------
    await queryRunner.query(`
      CREATE TABLE "status_update" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "prev_status"        SMALLINT NOT NULL,
        "new_status"         SMALLINT NOT NULL,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_status_update" PRIMARY KEY ("id"),
        CONSTRAINT "fk_status_update_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_status_update_surgery_request_id" ON "status_update" ("surgery_request_id");`,
    );

    // ---------- surgery_request_analysis ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_analysis" (
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
        CONSTRAINT "pk_surgery_request_analysis" PRIMARY KEY ("id"),
        CONSTRAINT "uq_surgery_request_analysis_sr_id" UNIQUE ("surgery_request_id"),
        CONSTRAINT "fk_sra_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- surgery_request_billing ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_billing" (
        "id"                      UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id"      UUID NOT NULL,
        "created_by_id"           UUID NOT NULL,
        "invoice_protocol"        VARCHAR(100) NOT NULL,
        "invoice_sent_at"         TIMESTAMP NOT NULL,
        "invoice_value"           NUMERIC(12, 2) NOT NULL,
        "payment_deadline"        DATE,
        "received_value"          NUMERIC(12, 2),
        "received_at"             TIMESTAMP,
        "receipt_notes"           TEXT,
        "contested_received_value" NUMERIC(12, 2),
        "contested_received_at"   TIMESTAMP,
        "contested_receipt_notes" TEXT,
        "created_at"              TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_billing" PRIMARY KEY ("id"),
        CONSTRAINT "uq_surgery_request_billing_sr_id" UNIQUE ("surgery_request_id"),
        CONSTRAINT "fk_srb_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_srb_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- surgery_request_template ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_template" (
        "id"            UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"     UUID NOT NULL,
        "name"          VARCHAR(100) NOT NULL,
        "template_data" JSONB NOT NULL,
        "usage_count"   INTEGER NOT NULL DEFAULT 0,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_template" PRIMARY KEY ("id"),
        CONSTRAINT "fk_srt_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_surgery_request_template_doctor_id" ON "surgery_request_template" ("doctor_id");`,
    );

    // ---------- surgery_request_activity ----------
    await queryRunner.query(`
      CREATE TABLE "surgery_request_activity" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "user_id"            UUID,
        "type"               "activity_type_enum" NOT NULL DEFAULT 'comment',
        "content"            TEXT NOT NULL,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surgery_request_activity" PRIMARY KEY ("id"),
        CONSTRAINT "fk_activity_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_activity_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_activity_surgery_request_id" ON "surgery_request_activity" ("surgery_request_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_created_at" ON "surgery_request_activity" ("created_at" DESC);`,
    );

    // ---------- chat ----------
    await queryRunner.query(`
      CREATE TABLE "chat" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "user_id"            UUID NOT NULL,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_chat" PRIMARY KEY ("id"),
        CONSTRAINT "fk_chat_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_chat_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_chat_surgery_request_id" ON "chat" ("surgery_request_id");`,
    );

    // ---------- chat_message ----------
    await queryRunner.query(`
      CREATE TABLE "chat_message" (
        "id"         UUID NOT NULL DEFAULT uuid_generate_v4(),
        "chat_id"    UUID NOT NULL,
        "sender_id"  UUID NOT NULL,
        "read"       BOOLEAN NOT NULL DEFAULT false,
        "message"    TEXT NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_chat_message" PRIMARY KEY ("id"),
        CONSTRAINT "fk_chat_message_chat"
          FOREIGN KEY ("chat_id") REFERENCES "chat"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_chat_message_sender"
          FOREIGN KEY ("sender_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_chat_message_chat_id" ON "chat_message" ("chat_id");`,
    );

    // ---------- notification ----------
    await queryRunner.query(`
      CREATE TABLE "notification" (
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
        CONSTRAINT "pk_notification" PRIMARY KEY ("id"),
        CONSTRAINT "fk_notification_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_notification_user_read" ON "notification" ("user_id", "read");`,
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
        CONSTRAINT "uq_user_notification_settings_user" UNIQUE ("user_id"),
        CONSTRAINT "fk_user_notification_settings_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    // ---------- default_document_clinic ----------
    await queryRunner.query(`
      CREATE TABLE "default_document_clinic" (
        "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
        "doctor_id"   UUID NOT NULL,
        "created_by"  UUID NOT NULL,
        "key"         VARCHAR(50) NOT NULL,
        "name"        VARCHAR(100) NOT NULL,
        "file_url"    VARCHAR(255),
        "description" TEXT,
        "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_default_document_clinic" PRIMARY KEY ("id"),
        CONSTRAINT "fk_default_document_clinic_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_default_document_clinic_created_by"
          FOREIGN KEY ("created_by") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_default_document_clinic_doctor_id" ON "default_document_clinic" ("doctor_id");`,
    );

    // ---------- report_section ----------
    await queryRunner.query(`
      CREATE TABLE "report_section" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "title"              VARCHAR(255) NOT NULL,
        "description"        TEXT,
        "order"              INTEGER NOT NULL DEFAULT 0,
        "surgery_request_id" UUID NOT NULL,
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_report_section" PRIMARY KEY ("id"),
        CONSTRAINT "fk_report_section_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_report_section_surgery_request_id" ON "report_section" ("surgery_request_id");`,
    );

    // ---------- stale_notification_log ----------
    await queryRunner.query(`
      CREATE TABLE "stale_notification_log" (
        "id"                 UUID NOT NULL DEFAULT uuid_generate_v4(),
        "surgery_request_id" UUID NOT NULL,
        "stale_days"         INTEGER NOT NULL,
        "channel"            VARCHAR(20) NOT NULL DEFAULT 'in_app',
        "notified_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_stale_notification_log" PRIMARY KEY ("id"),
        CONSTRAINT "fk_stale_notification_log_surgery_request"
          FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_stale_log_request_days" ON "stale_notification_log" ("surgery_request_id", "stale_days");`,
    );

    // ================================================================ //
    // 9. WHATSAPP / IA CONVERSAÇÃO
    // ================================================================ //

    // ---------- whatsapp_conversation ----------
    await queryRunner.query(`
      CREATE TABLE "whatsapp_conversation" (
        "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
        "phone"                VARCHAR(20) NOT NULL,
        "user_id"              UUID,
        "account_id"           UUID,
        "messages_history"     JSONB NOT NULL DEFAULT '[]'::jsonb,
        "conversation_summary" TEXT,
        "conversation_memory"  JSONB NOT NULL DEFAULT '{}'::jsonb,
        "summary_updated_at"   TIMESTAMPTZ,
        "summary_version"      INTEGER NOT NULL DEFAULT 1,
        "started_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_message_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "active"               BOOLEAN NOT NULL DEFAULT true,
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_whatsapp_conversation" PRIMARY KEY ("id"),
        CONSTRAINT "fk_whatsapp_conversation_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_whatsapp_conversation_account"
          FOREIGN KEY ("account_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_whatsapp_conversation_phone"   ON "whatsapp_conversation" ("phone");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_whatsapp_conversation_active"  ON "whatsapp_conversation" ("active", "last_message_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_whatsapp_conversation_account" ON "whatsapp_conversation" ("account_id");`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_whatsapp_conversation_phone_active"
         ON "whatsapp_conversation" ("phone")
         WHERE "active" = true;`,
    );

    // ---------- whatsapp_conversation_message ----------
    await queryRunner.query(`
      CREATE TABLE "whatsapp_conversation_message" (
        "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" UUID NOT NULL,
        "role"            VARCHAR(20) NOT NULL,
        "content"         TEXT NOT NULL,
        "tool_name"       VARCHAR(100),
        "metadata"        JSONB,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_whatsapp_conversation_message" PRIMARY KEY ("id"),
        CONSTRAINT "fk_wcm_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_wcm_conversation_created" ON "whatsapp_conversation_message" ("conversation_id", "created_at");`,
    );

    // ---------- whatsapp_message_log ----------
    // Mantida com nome canônico (entity correspondente continua mapeada
    // para esta tabela); contém todas as colunas finais (observabilidade
    // + multi-tenant). Esta é a única migration que mexe nela.
    await queryRunner.query(`
      CREATE TABLE "whatsapp_message_log" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "to"              VARCHAR(20) NOT NULL,
        "body"            TEXT NOT NULL,
        "status"          "whatsapp_message_log_status_enum" NOT NULL DEFAULT 'sent',
        "error_message"   TEXT,
        "sent_at"         TIMESTAMPTZ,
        "message_sid"     VARCHAR(64),
        "user_id"         UUID,
        "conversation_id" UUID,
        "account_id"      UUID,
        "direction"       VARCHAR(10) NOT NULL DEFAULT 'outbound',
        "type"            VARCHAR(20) NOT NULL DEFAULT 'freeform',
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_whatsapp_message_log" PRIMARY KEY ("id"),
        CONSTRAINT "fk_whatsapp_message_log_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_whatsapp_message_log_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_whatsapp_message_log_account"
          FOREIGN KEY ("account_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_wml_message_sid"    ON "whatsapp_message_log" ("message_sid");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wml_to_created"     ON "whatsapp_message_log" ("to", "created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wml_status_created" ON "whatsapp_message_log" ("status", "created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wml_account"        ON "whatsapp_message_log" ("account_id");`,
    );

    // ---------- notification_send_log ----------
    await queryRunner.query(`
      CREATE TABLE "notification_send_log" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "channel"           "notification_channel_enum" NOT NULL,
        "status"            "notification_send_status_enum" NOT NULL DEFAULT 'queued',
        "to"                VARCHAR(255) NOT NULL,
        "subject"           VARCHAR(255),
        "template"          VARCHAR(100),
        "body"              TEXT,
        "error_message"     TEXT,
        "job_id"            VARCHAR(100),
        "attempts"          INTEGER NOT NULL DEFAULT 0,
        "sent_at"           TIMESTAMPTZ,
        "message_sid"       VARCHAR(64),
        "user_id"           UUID,
        "conversation_id"   UUID,
        "account_id"        UUID,
        "direction"         VARCHAR(10) DEFAULT 'outbound',
        "notification_type" VARCHAR(20) DEFAULT 'freeform',
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_send_log" PRIMARY KEY ("id"),
        CONSTRAINT "fk_nsl_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_nsl_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_nsl_account"
          FOREIGN KEY ("account_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_channel_status" ON "notification_send_log" ("channel", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_created_at"     ON "notification_send_log" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_account"        ON "notification_send_log" ("account_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nsl_message_sid"    ON "notification_send_log" ("message_sid");`,
    );

    // ================================================================ //
    // 10. IA — RAG, TOKENS, PII E CONSENTIMENTOS
    // ================================================================ //

    // ---------- ai_knowledge_chunk ----------
    await queryRunner.query(`
      CREATE TABLE "ai_knowledge_chunk" (
        "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
        "category"   VARCHAR(50) NOT NULL,
        "title"      TEXT NOT NULL,
        "content"    TEXT NOT NULL,
        "metadata"   JSONB,
        "embedding"  vector(1536),
        "active"     BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_knowledge_chunk" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_knowledge_category_active" ON "ai_knowledge_chunk" ("category", "active");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_knowledge_embedding"
         ON "ai_knowledge_chunk"
         USING ivfflat ("embedding" vector_cosine_ops)
         WITH (lists = 100);`,
    );

    // ---------- ai_token_usage_log ----------
    await queryRunner.query(`
      CREATE TABLE "ai_token_usage_log" (
        "id"                  UUID NOT NULL DEFAULT uuid_generate_v4(),
        "message_sid"         VARCHAR(64) NOT NULL,
        "phone"               VARCHAR(20) NOT NULL,
        "user_id"             UUID,
        "conversation_id"     UUID,
        "account_id"          UUID,
        "prompt_tokens"       INTEGER NOT NULL DEFAULT 0,
        "completion_tokens"   INTEGER NOT NULL DEFAULT 0,
        "total_tokens"        INTEGER NOT NULL DEFAULT 0,
        "calls_count"         INTEGER NOT NULL DEFAULT 0,
        "model"               VARCHAR(50),
        "latency_ms"          INTEGER,
        "cost_estimate_cents" INTEGER,
        "breakdown"           JSONB NOT NULL DEFAULT '[]'::jsonb,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_token_usage_log" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_token_usage_log_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_ai_token_usage_log_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "fk_ai_token_usage_log_account"
          FOREIGN KEY ("account_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_usage_message_sid"             ON "ai_token_usage_log" ("message_sid");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_usage_conversation_created_at" ON "ai_token_usage_log" ("conversation_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_usage_user_created_at"         ON "ai_token_usage_log" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_usage_created_at"              ON "ai_token_usage_log" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_token_usage_account"                 ON "ai_token_usage_log" ("account_id");`,
    );

    // ---------- ai_pii_redaction_log ----------
    await queryRunner.query(`
      CREATE TABLE "ai_pii_redaction_log" (
        "id"              UUID NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" UUID,
        "message_sid"     VARCHAR(64),
        "category"        VARCHAR(40) NOT NULL,
        "value_hash"      VARCHAR(64) NOT NULL,
        "blocked"         BOOLEAN NOT NULL DEFAULT false,
        "tool_name"       VARCHAR(100),
        "occurrences"     INTEGER NOT NULL DEFAULT 1,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_pii_redaction_log" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_pii_log_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversation"("id")
          ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ai_pii_log_category_created" ON "ai_pii_redaction_log" ("category", "created_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_pii_log_conversation"     ON "ai_pii_redaction_log" ("conversation_id");`,
    );

    // ---------- consent_log (LGPD) ----------
    await queryRunner.query(`
      CREATE TABLE "consent_log" (
        "id"           UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"      UUID NOT NULL,
        "consent_type" VARCHAR(40) NOT NULL,
        "version"      VARCHAR(20) NOT NULL,
        "action"       VARCHAR(20) NOT NULL,
        "ip_address"   VARCHAR(45),
        "user_agent"   TEXT,
        "channel"      VARCHAR(20) NOT NULL DEFAULT 'web',
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_consent_log" PRIMARY KEY ("id"),
        CONSTRAINT "fk_consent_log_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_consent_log_user_type_created" ON "consent_log" ("user_id", "consent_type", "created_at" DESC);`,
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
    // Tabelas (ordem reversa às FKs)
    const tables = [
      'conversation_cleanup_log',
      'consent_log',
      'ai_pii_redaction_log',
      'ai_token_usage_log',
      'ai_knowledge_chunk',
      'notification_send_log',
      'whatsapp_message_log',
      'whatsapp_conversation_message',
      'whatsapp_conversation',
      'stale_notification_log',
      'report_section',
      'default_document_clinic',
      'user_notification_settings',
      'notification',
      'chat_message',
      'chat',
      'surgery_request_activity',
      'surgery_request_template',
      'surgery_request_billing',
      'surgery_request_analysis',
      'status_update',
      'document',
      'contestation',
      'surgery_request_quotation',
      'opme_item_supplier',
      'opme_item',
      'surgery_request_tuss_item',
      'surgery_request',
      'patient',
      'supplier',
      'health_plan',
      'hospital',
      'user_doctor_access',
      'doctor_header',
      'doctor_profile',
      'recovery_code',
      'refresh_token',
      'tuss',
      'cid',
      'procedure',
      'user',
      'subscription_plan',
    ];

    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }

    await queryRunner.query(`DROP FUNCTION IF EXISTS generate_protocol;`);

    const enums = [
      'notification_send_status_enum',
      'notification_channel_enum',
      'whatsapp_message_log_status_enum',
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
