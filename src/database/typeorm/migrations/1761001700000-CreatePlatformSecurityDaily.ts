import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformSecurityDaily1761001700000 implements MigrationInterface {
  name = 'CreatePlatformSecurityDaily1761001700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "platform_security_daily" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid,
         "user_id" uuid,
         "day" date NOT NULL,
         "event_type" character varying(30) NOT NULL,
         "count" integer NOT NULL DEFAULT 1,
         "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         "last_request_id" character varying(100),
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_platform_security_daily" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_platform_security_daily_key"
           UNIQUE NULLS NOT DISTINCT ("owner_id", "user_id", "day", "event_type"),
         CONSTRAINT "CHK_platform_security_daily_event"
           CHECK ("event_type" IN ('login_failed', 'login_locked', 'mfa_failed', 'refresh_reuse', 'password_changed', 'mfa_enabled', 'mfa_disabled'))
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_security_daily_day_event"
         ON "platform_security_daily" ("day", "event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_security_daily_owner_day"
         ON "platform_security_daily" ("owner_id", "day")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_security_daily"`);
  }
}
