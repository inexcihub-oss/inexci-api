import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformMetricsDaily1761001300000 implements MigrationInterface {
  name = 'CreatePlatformMetricsDaily1761001300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "platform_metrics_daily" (
         "day" date NOT NULL,
         "accounts_total" integer NOT NULL,
         "accounts_by_situation" jsonb,
         "mrr_cents" integer NOT NULL,
         "paying_accounts" integer NOT NULL,
         "trial_accounts" integer,
         "new_accounts" integer NOT NULL,
         "canceled_accounts" integer NOT NULL,
         "active_accounts_7d" integer,
         "active_accounts_30d" integer,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_platform_metrics_daily" PRIMARY KEY ("day")
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_metrics_daily"`);
  }
}
