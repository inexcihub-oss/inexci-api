import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Simplifica o tratamento de consentimentos LGPD:
 *  - Remove o versionamento (MAJOR.MINOR) dos termos.
 *  - Substitui as 6 colunas `*_consent_at`/`*_consent_version` em `users`
 *    por 3 colunas `*_accepted_at`.
 *  - Remove a tabela `consent_logs` (auditoria histórica não é mais
 *    necessária; o estado fica nos próprios timestamps em `users`).
 */
export class SimplifyConsents1746540000000 implements MigrationInterface {
  name = 'SimplifyConsents1746540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "privacy_policy_accepted_at" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "terms_of_use_accepted_at"   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "ai_consent_accepted_at"     TIMESTAMPTZ;
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET
        "privacy_policy_accepted_at" = "privacy_policy_consent_at",
        "terms_of_use_accepted_at"   = "terms_of_use_consent_at",
        "ai_consent_accepted_at"     = "ai_consent_at";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "ai_consent_at",
        DROP COLUMN IF EXISTS "ai_consent_version",
        DROP COLUMN IF EXISTS "privacy_policy_consent_at",
        DROP COLUMN IF EXISTS "privacy_policy_consent_version",
        DROP COLUMN IF EXISTS "terms_of_use_consent_at",
        DROP COLUMN IF EXISTS "terms_of_use_consent_version";
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_consent_logs_user_type_created";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "consent_logs";`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "ai_consent_at"                  TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "ai_consent_version"             VARCHAR(20),
        ADD COLUMN IF NOT EXISTS "privacy_policy_consent_at"      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "privacy_policy_consent_version" VARCHAR(20),
        ADD COLUMN IF NOT EXISTS "terms_of_use_consent_at"        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "terms_of_use_consent_version"   VARCHAR(20);
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET
        "privacy_policy_consent_at"      = "privacy_policy_accepted_at",
        "privacy_policy_consent_version" = CASE WHEN "privacy_policy_accepted_at" IS NULL THEN NULL ELSE '1.0' END,
        "terms_of_use_consent_at"        = "terms_of_use_accepted_at",
        "terms_of_use_consent_version"   = CASE WHEN "terms_of_use_accepted_at"   IS NULL THEN NULL ELSE '1.0' END,
        "ai_consent_at"                  = "ai_consent_accepted_at",
        "ai_consent_version"             = CASE WHEN "ai_consent_accepted_at"     IS NULL THEN NULL ELSE '1.0' END;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "privacy_policy_accepted_at",
        DROP COLUMN IF EXISTS "terms_of_use_accepted_at",
        DROP COLUMN IF EXISTS "ai_consent_accepted_at";
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "consent_logs" (
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
      `CREATE INDEX IF NOT EXISTS "idx_consent_logs_user_type_created" ON "consent_logs" ("user_id", "consent_type", "created_at" DESC);`,
    );
  }
}
