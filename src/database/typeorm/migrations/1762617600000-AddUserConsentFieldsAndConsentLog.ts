import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserConsentFieldsAndConsentLog1762617600000 implements MigrationInterface {
  name = 'AddUserConsentFieldsAndConsentLog1762617600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
        ADD COLUMN IF NOT EXISTS "ai_consent_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "ai_consent_version" character varying(20) NULL,
        ADD COLUMN IF NOT EXISTS "privacy_policy_consent_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "privacy_policy_consent_version" character varying(20) NULL,
        ADD COLUMN IF NOT EXISTS "terms_of_use_consent_at" TIMESTAMP WITH TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS "terms_of_use_consent_version" character varying(20) NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "consent_log" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" UUID NOT NULL,
        "consent_type" character varying(40) NOT NULL,
        "version" character varying(20) NOT NULL,
        "action" character varying(20) NOT NULL,
        "ip_address" character varying(45),
        "user_agent" text,
        "channel" character varying(20) NOT NULL DEFAULT 'web',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_consent_log" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_consent_log_user_type_created"
      ON "consent_log" ("user_id", "consent_type", "created_at" DESC);
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "consent_log"
        ADD CONSTRAINT "FK_consent_log_user"
        FOREIGN KEY ("user_id") REFERENCES "user"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "consent_log"
      DROP CONSTRAINT IF EXISTS "FK_consent_log_user";
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_consent_log_user_type_created";`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "consent_log";`);

    await queryRunner.query(`
      ALTER TABLE "user"
        DROP COLUMN IF EXISTS "terms_of_use_consent_version",
        DROP COLUMN IF EXISTS "terms_of_use_consent_at",
        DROP COLUMN IF EXISTS "privacy_policy_consent_version",
        DROP COLUMN IF EXISTS "privacy_policy_consent_at",
        DROP COLUMN IF EXISTS "ai_consent_version",
        DROP COLUMN IF EXISTS "ai_consent_at";
    `);
  }
}
