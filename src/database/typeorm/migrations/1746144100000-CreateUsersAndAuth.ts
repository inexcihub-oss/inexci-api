import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Usuários, autenticação e perfil médico.
 *
 * Tabelas:
 *  - users (auto-referenciada via owner_id e admin_id)
 *  - refresh_tokens, recovery_codes
 *  - doctor_profiles, doctor_headers
 *  - user_doctor_accesses (vínculo binário colaborador ↔ médico)
 *
 * Consentimentos LGPD vivem como timestamps em `users` (sem versionamento,
 * sem tabela de auditoria).
 */
export class CreateUsersAndAuth1746144100000 implements MigrationInterface {
  name = 'CreateUsersAndAuth1746144100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
        "privacy_policy_accepted_at"      TIMESTAMPTZ,
        "terms_of_use_accepted_at"        TIMESTAMPTZ,
        "ai_consent_accepted_at"          TIMESTAMPTZ,
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'user_doctor_accesses',
      'doctor_headers',
      'doctor_profiles',
      'recovery_codes',
      'refresh_tokens',
      'users',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }
  }
}
