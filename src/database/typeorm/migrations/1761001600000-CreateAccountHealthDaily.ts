import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountHealthDaily1761001600000 implements MigrationInterface {
  name = 'CreateAccountHealthDaily1761001600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "account_health_daily" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "owner_id" uuid NOT NULL,
         "day" date NOT NULL,
         "score" smallint NOT NULL,
         "band" character varying(10) NOT NULL,
         "factors" jsonb NOT NULL,
         "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         CONSTRAINT "PK_account_health_daily" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_account_health_daily_owner_day" UNIQUE ("owner_id", "day"),
         CONSTRAINT "CHK_account_health_daily_band"
           CHECK ("band" IN ('healthy', 'attention', 'risk')),
         CONSTRAINT "CHK_account_health_daily_score"
           CHECK ("score" BETWEEN 0 AND 100),
         CONSTRAINT "FK_account_health_daily_owner"
           FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_account_health_daily_day_band"
         ON "account_health_daily" ("day", "band", "score")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_health_daily"`);
  }
}
