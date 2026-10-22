import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthDocumentsStaleTimestampsWithTimeZone1761000300000 implements MigrationInterface {
  name = 'AuthDocumentsStaleTimestampsWithTimeZone1761000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "recovery_codes"
          ALTER COLUMN "expires_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "expires_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "reset_token_expires_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "reset_token_expires_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "users"
          ALTER COLUMN "email_verified_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "email_verified_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "email_verification_expires_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "email_verification_expires_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "documents"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "stale_notification_logs"
          ALTER COLUMN "notified_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "notified_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "recovery_codes"
          ALTER COLUMN "expires_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "expires_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "reset_token_expires_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "reset_token_expires_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "users"
          ALTER COLUMN "email_verified_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "email_verified_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "email_verification_expires_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "email_verification_expires_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "documents"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "stale_notification_logs"
          ALTER COLUMN "notified_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "notified_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }
}
