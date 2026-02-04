import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorCompleteSchema1768720000000 implements MigrationInterface {
  name = 'RefactorCompleteSchema1768720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========================================
    // DROPAR TODAS AS TABELAS EXISTENTES
    // ========================================

    // Dropar constraints primeiro
    await queryRunner.query(
      `DROP TABLE IF EXISTS "doctor_collaborator" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user_notification_settings" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification" CASCADE`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "default_document_clinic" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_message" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "status_update" CASCADE`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_procedure" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "opme_item" CASCADE`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "surgery_request_quotation" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_request" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recovery_code" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "clinic" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "procedure" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cid" CASCADE`);

    // Dropar enums antigos se existirem
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."notification_type_enum" CASCADE`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."doctor_collaborator_status_enum" CASCADE`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."collaborator_access_level_enum" CASCADE`,
    );

    // ========================================
    // CRIAR ENUMS
    // ========================================

    // Enum para role do usuário
    await queryRunner.query(`
      CREATE TYPE "public"."user_role_enum" AS ENUM ('admin', 'doctor', 'collaborator')
    `);

    // Enum para status da assinatura
    await queryRunner.query(`
      CREATE TYPE "public"."subscription_status_enum" AS ENUM ('trial', 'active', 'expired', 'cancelled')
    `);

    // Enum para role do membro da equipe
    await queryRunner.query(`
      CREATE TYPE "public"."team_member_role_enum" AS ENUM ('manager', 'editor', 'viewer')
    `);

    // Enum para tipo de notificação
    await queryRunner.query(`
      CREATE TYPE "public"."notification_type_enum" AS ENUM ('new_surgery_request', 'status_update', 'pendency', 'expiring_document', 'system', 'info')
    `);

    // ========================================
    // TABELAS BASE (sem dependências)
    // ========================================

    // Tabela CID (diagnósticos)
    await queryRunner.query(`
      CREATE TABLE "cid" (
        "id" character varying(75) NOT NULL,
        "description" character varying(75) NOT NULL,
        CONSTRAINT "PK_cid" PRIMARY KEY ("id")
      )
    `);

    // Tabela de procedimentos
    await queryRunner.query(`
      CREATE TABLE "procedure" (
        "id" SERIAL NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "tuss_code" character varying(100) NOT NULL,
        "name" character varying(255) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_procedure" PRIMARY KEY ("id")
      )
    `);

    // ========================================
    // TABELA DE USUÁRIOS
    // ========================================

    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" SERIAL NOT NULL,
        "role" "public"."user_role_enum" NOT NULL DEFAULT 'doctor',
        "status" smallint NOT NULL DEFAULT 1,
        "email" character varying(100) NOT NULL,
        "password" character varying(60),
        "name" character varying(100) NOT NULL,
        "phone" character varying(15),
        "cpf" character varying(14),
        "gender" character(1),
        "birth_date" date,
        "avatar_url" character varying(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_email" UNIQUE ("email"),
        CONSTRAINT "PK_user" PRIMARY KEY ("id")
      )
    `);

    // ========================================
    // PERFIL DO MÉDICO (extensão do usuário)
    // ========================================

    await queryRunner.query(`
      CREATE TABLE "doctor_profile" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "specialty" character varying(100),
        "crm" character varying(20),
        "crm_state" character(2),
        "signature_url" character varying(255),
        "clinic_name" character varying(150),
        "clinic_cnpj" character varying(20),
        "clinic_address" character varying(255),
        "subscription_status" "public"."subscription_status_enum" NOT NULL DEFAULT 'trial',
        "subscription_plan" character varying(50),
        "subscription_expires_at" TIMESTAMP,
        "max_requests_per_month" integer NOT NULL DEFAULT 50,
        "max_team_members" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_doctor_profile_user_id" UNIQUE ("user_id"),
        CONSTRAINT "PK_doctor_profile" PRIMARY KEY ("id"),
        CONSTRAINT "FK_doctor_profile_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // ========================================
    // MEMBRO DA EQUIPE (relacionamento médico-colaborador)
    // ========================================

    await queryRunner.query(`
      CREATE TABLE "team_member" (
        "id" SERIAL NOT NULL,
        "doctor_id" integer NOT NULL,
        "collaborator_id" integer NOT NULL,
        "role" "public"."team_member_role_enum" NOT NULL DEFAULT 'editor',
        "status" smallint NOT NULL DEFAULT 1,
        "can_create_requests" boolean NOT NULL DEFAULT true,
        "can_edit_requests" boolean NOT NULL DEFAULT true,
        "can_delete_requests" boolean NOT NULL DEFAULT false,
        "can_manage_documents" boolean NOT NULL DEFAULT true,
        "can_manage_patients" boolean NOT NULL DEFAULT true,
        "can_manage_billing" boolean NOT NULL DEFAULT false,
        "can_manage_team" boolean NOT NULL DEFAULT false,
        "can_view_reports" boolean NOT NULL DEFAULT true,
        "notes" text,
        "invited_at" TIMESTAMP,
        "accepted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_team_member_doctor_collaborator" UNIQUE ("doctor_id", "collaborator_id"),
        CONSTRAINT "PK_team_member" PRIMARY KEY ("id"),
        CONSTRAINT "FK_team_member_doctor" FOREIGN KEY ("doctor_id") REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_team_member_collaborator" FOREIGN KEY ("collaborator_id") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // ========================================
    // ENTIDADES DE NEGÓCIO
    // ========================================

    // Plano de Saúde
    await queryRunner.query(`
      CREATE TABLE "health_plan" (
        "id" SERIAL NOT NULL,
        "name" character varying(150) NOT NULL,
        "ans_code" character varying(20),
        "cnpj" character varying(20),
        "email" character varying(100),
        "phone" character varying(15),
        "authorization_contact" character varying(100),
        "authorization_phone" character varying(15),
        "authorization_email" character varying(100),
        "website" character varying(255),
        "portal_url" character varying(255),
        "notes" text,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_health_plan" PRIMARY KEY ("id")
      )
    `);

    // Hospital
    await queryRunner.query(`
      CREATE TABLE "hospital" (
        "id" SERIAL NOT NULL,
        "name" character varying(150) NOT NULL,
        "cnpj" character varying(20),
        "email" character varying(100),
        "phone" character varying(15),
        "contact_name" character varying(100),
        "contact_phone" character varying(15),
        "contact_email" character varying(100),
        "zip_code" character varying(10),
        "address" character varying(200),
        "address_number" character varying(20),
        "neighborhood" character varying(100),
        "city" character varying(100),
        "state" character(2),
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hospital" PRIMARY KEY ("id")
      )
    `);

    // Fornecedor (OPME)
    await queryRunner.query(`
      CREATE TABLE "supplier" (
        "id" SERIAL NOT NULL,
        "name" character varying(150) NOT NULL,
        "cnpj" character varying(20),
        "email" character varying(100),
        "phone" character varying(15),
        "contact_name" character varying(100),
        "contact_phone" character varying(15),
        "contact_email" character varying(100),
        "zip_code" character varying(10),
        "address" character varying(200),
        "address_number" character varying(20),
        "neighborhood" character varying(100),
        "city" character varying(100),
        "state" character(2),
        "notes" text,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier" PRIMARY KEY ("id")
      )
    `);

    // Paciente
    await queryRunner.query(`
      CREATE TABLE "patient" (
        "id" SERIAL NOT NULL,
        "doctor_id" integer NOT NULL,
        "name" character varying(100) NOT NULL,
        "email" character varying(100),
        "phone" character varying(15),
        "cpf" character varying(14),
        "gender" character(1),
        "birth_date" date,
        "health_plan_id" integer,
        "health_plan_number" character varying(50),
        "health_plan_type" character varying(100),
        "zip_code" character varying(10),
        "address" character varying(200),
        "address_number" character varying(20),
        "address_complement" character varying(100),
        "neighborhood" character varying(100),
        "city" character varying(100),
        "state" character(2),
        "medical_notes" text,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient" PRIMARY KEY ("id"),
        CONSTRAINT "FK_patient_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_patient_health_plan" FOREIGN KEY ("health_plan_id") REFERENCES "health_plan"("id") ON DELETE SET NULL
      )
    `);

    // ========================================
    // SOLICITAÇÃO CIRÚRGICA
    // ========================================

    await queryRunner.query(`
      CREATE TABLE "surgery_request" (
        "id" SERIAL NOT NULL,
        "doctor_id" integer NOT NULL,
        "created_by_id" integer NOT NULL,
        "patient_id" integer NOT NULL,
        "hospital_id" integer,
        "health_plan_id" integer,
        "cid_id" character varying(75),
        "status" smallint NOT NULL DEFAULT 1,
        "protocol" character varying(75),
        "priority" character varying(20),
        "deadline" TIMESTAMP,
        "is_indication" boolean NOT NULL DEFAULT false,
        "indication_name" character varying(100),
        "health_plan_registration" character varying(100),
        "health_plan_type" character varying(100),
        "health_plan_protocol" character varying(100),
        "diagnosis" text,
        "medical_report" text,
        "patient_history" text,
        "surgery_description" text,
        "date_options" jsonb,
        "selected_date_index" integer,
        "surgery_date" TIMESTAMP,
        "analysis_started_at" TIMESTAMP,
        "date_call" TIMESTAMP,
        "hospital_protocol" character varying(100),
        "invoiced_value" numeric(19,2),
        "received_value" numeric(19,2),
        "invoiced_date" TIMESTAMP,
        "received_date" TIMESTAMP,
        "cancel_reason" text,
        "cancelled_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_surgery_request_protocol" UNIQUE ("protocol"),
        CONSTRAINT "PK_surgery_request" PRIMARY KEY ("id"),
        CONSTRAINT "FK_surgery_request_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_request_created_by" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_request_patient" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_request_hospital" FOREIGN KEY ("hospital_id") REFERENCES "hospital"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_surgery_request_health_plan" FOREIGN KEY ("health_plan_id") REFERENCES "health_plan"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_surgery_request_cid" FOREIGN KEY ("cid_id") REFERENCES "cid"("id") ON DELETE SET NULL
      )
    `);

    // ========================================
    // TABELAS RELACIONADAS À SOLICITAÇÃO
    // ========================================

    // Procedimentos da solicitação
    await queryRunner.query(`
      CREATE TABLE "surgery_request_procedure" (
        "id" SERIAL NOT NULL,
        "surgery_request_id" integer NOT NULL,
        "procedure_id" integer NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "authorized_quantity" integer,
        CONSTRAINT "PK_surgery_request_procedure" PRIMARY KEY ("id"),
        CONSTRAINT "FK_surgery_request_procedure_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_request_procedure_procedure" FOREIGN KEY ("procedure_id") REFERENCES "procedure"("id") ON DELETE CASCADE
      )
    `);

    // Itens de OPME
    await queryRunner.query(`
      CREATE TABLE "opme_item" (
        "id" SERIAL NOT NULL,
        "surgery_request_id" integer NOT NULL,
        "name" character varying(75) NOT NULL,
        "brand" character varying(75) NOT NULL,
        "distributor" character varying(75) NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "authorized_quantity" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_opme_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_opme_item_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE CASCADE
      )
    `);

    // Cotações de fornecedores
    await queryRunner.query(`
      CREATE TABLE "surgery_request_quotation" (
        "id" SERIAL NOT NULL,
        "surgery_request_id" integer NOT NULL,
        "supplier_id" integer NOT NULL,
        "proposal_number" character varying(100),
        "total_value" numeric(19,2),
        "submission_date" date,
        "valid_until" date,
        "notes" text,
        "selected" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_request_quotation" PRIMARY KEY ("id"),
        CONSTRAINT "FK_surgery_request_quotation_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_request_quotation_supplier" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE
      )
    `);

    // Atualizações de status
    await queryRunner.query(`
      CREATE TABLE "status_update" (
        "id" SERIAL NOT NULL,
        "surgery_request_id" integer NOT NULL,
        "prev_status" smallint NOT NULL,
        "new_status" smallint NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_status_update" PRIMARY KEY ("id"),
        CONSTRAINT "FK_status_update_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE CASCADE
      )
    `);

    // ========================================
    // DOCUMENTOS
    // ========================================

    await queryRunner.query(`
      CREATE TABLE "document" (
        "id" SERIAL NOT NULL,
        "surgery_request_id" integer NOT NULL,
        "created_by" integer NOT NULL,
        "key" character varying(50) NOT NULL,
        "name" character varying(75) NOT NULL,
        "uri" character varying(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document" PRIMARY KEY ("id"),
        CONSTRAINT "FK_document_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_document_creator" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "default_document_clinic" (
        "id" SERIAL NOT NULL,
        "doctor_id" integer NOT NULL,
        "created_by" integer NOT NULL,
        "key" character varying(50) NOT NULL,
        "name" character varying(100) NOT NULL,
        "file_url" character varying(255),
        "description" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_default_document_clinic" PRIMARY KEY ("id"),
        CONSTRAINT "FK_default_document_clinic_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctor_profile"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_default_document_clinic_creator" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // ========================================
    // COMUNICAÇÃO
    // ========================================

    // Chat
    await queryRunner.query(`
      CREATE TABLE "chat" (
        "id" SERIAL NOT NULL,
        "surgery_request_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_request" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // Mensagens do chat
    await queryRunner.query(`
      CREATE TABLE "chat_message" (
        "id" SERIAL NOT NULL,
        "chat_id" integer NOT NULL,
        "sent_by" integer NOT NULL,
        "read" boolean NOT NULL DEFAULT false,
        "message" text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_message" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_message_chat" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_message_sender" FOREIGN KEY ("sent_by") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // Notificações
    await queryRunner.query(`
      CREATE TABLE "notification" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "type" "public"."notification_type_enum" NOT NULL DEFAULT 'info',
        "title" character varying(255) NOT NULL,
        "message" text NOT NULL,
        "read" boolean NOT NULL DEFAULT false,
        "link" character varying(255),
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // Configurações de notificação
    await queryRunner.query(`
      CREATE TABLE "user_notification_settings" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "email_new_request" boolean NOT NULL DEFAULT true,
        "email_status_change" boolean NOT NULL DEFAULT true,
        "email_new_document" boolean NOT NULL DEFAULT true,
        "email_new_message" boolean NOT NULL DEFAULT false,
        "email_deadline_reminder" boolean NOT NULL DEFAULT true,
        "push_new_request" boolean NOT NULL DEFAULT true,
        "push_status_change" boolean NOT NULL DEFAULT true,
        "push_new_document" boolean NOT NULL DEFAULT true,
        "push_new_message" boolean NOT NULL DEFAULT true,
        "push_deadline_reminder" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_notification_settings_user_id" UNIQUE ("user_id"),
        CONSTRAINT "PK_user_notification_settings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_notification_settings_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // ========================================
    // CÓDIGOS DE RECUPERAÇÃO
    // ========================================

    await queryRunner.query(`
      CREATE TABLE "recovery_code" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "code" character varying(6) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recovery_code" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recovery_code_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // ========================================
    // ÍNDICES PARA PERFORMANCE
    // ========================================

    await queryRunner.query(
      `CREATE INDEX "IDX_user_email" ON "user" ("email")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_user_role" ON "user" ("role")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_doctor_profile_user_id" ON "doctor_profile" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_team_member_doctor_id" ON "team_member" ("doctor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_team_member_collaborator_id" ON "team_member" ("collaborator_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_patient_doctor_id" ON "patient" ("doctor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_surgery_request_doctor_id" ON "surgery_request" ("doctor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_surgery_request_patient_id" ON "surgery_request" ("patient_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_surgery_request_status" ON "surgery_request" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_surgery_request_created_at" ON "surgery_request" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_user_id" ON "notification" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_read" ON "notification" ("read")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropar índices
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_read"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_user_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_surgery_request_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_surgery_request_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_surgery_request_patient_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_surgery_request_doctor_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_patient_doctor_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_team_member_collaborator_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_member_doctor_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_doctor_profile_user_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_role"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_email"`);

    // Dropar tabelas em ordem reversa
    await queryRunner.query(`DROP TABLE IF EXISTS "recovery_code"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user_notification_settings"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_message"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "default_document_clinic"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "status_update"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_request_quotation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "opme_item"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_request_procedure"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_request"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "patient"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "supplier"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hospital"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "health_plan"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "team_member"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "doctor_profile"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "procedure"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cid"`);

    // Dropar enums
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."notification_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."team_member_role_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."subscription_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."user_role_enum"`);
  }
}
