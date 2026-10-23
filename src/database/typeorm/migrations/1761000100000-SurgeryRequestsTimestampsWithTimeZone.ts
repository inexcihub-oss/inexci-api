import { MigrationInterface, QueryRunner } from 'typeorm';
import { exigirBancoEmUtc } from '../preflight/banco-em-utc';

export class SurgeryRequestsTimestampsWithTimeZone1761000100000 implements MigrationInterface {
  name = 'SurgeryRequestsTimestampsWithTimeZone1761000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await exigirBancoEmUtc(queryRunner, this.name);
    await queryRunner.query(`
        ALTER TABLE "surgery_requests"
          ALTER COLUMN "surgery_date" TYPE TIMESTAMP WITH TIME ZONE
            USING "surgery_date" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "analysis_started_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "analysis_started_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "date_call" TYPE TIMESTAMP WITH TIME ZONE
            USING "date_call" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "sent_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "sent_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "surgery_performed_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "surgery_performed_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "closed_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "closed_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "last_status_changed_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "last_status_changed_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_activities"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "surgery_requests"
          ALTER COLUMN "surgery_date" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "surgery_date" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "analysis_started_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "analysis_started_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "date_call" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "date_call" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "sent_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "sent_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "surgery_performed_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "surgery_performed_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "closed_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "closed_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "last_status_changed_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "last_status_changed_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_activities"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }
}
