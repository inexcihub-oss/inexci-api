import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformErrorDaily1761001500000 implements MigrationInterface {
  name = 'CreatePlatformErrorDaily1761001500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "platform_error_daily" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid,
         "day" date NOT NULL,
         "source" character varying(20) NOT NULL,
         "fingerprint" character varying(64) NOT NULL,
         "error_class" character varying(100),
         "sample_route" character varying(200),
         "count" integer NOT NULL DEFAULT 1,
         "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         "last_message" character varying(300),
         "last_request_id" character varying(100),
         "last_trace_id" character varying(64),
         "last_user_id" uuid,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_platform_error_daily" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_platform_error_daily_key"
           UNIQUE NULLS NOT DISTINCT ("owner_id", "day", "source", "fingerprint"),
         CONSTRAINT "CHK_platform_error_daily_source"
           CHECK ("source" IN ('http', 'queue', 'ai', 'notification', 'stripe_webhook'))
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_error_daily_day" ON "platform_error_daily" ("day")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_error_daily_owner_day"
         ON "platform_error_daily" ("owner_id", "day")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_platform_error_daily_fingerprint"
         ON "platform_error_daily" ("fingerprint")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_error_daily"`);
  }
}
