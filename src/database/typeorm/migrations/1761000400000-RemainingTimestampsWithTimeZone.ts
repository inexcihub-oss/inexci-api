import { MigrationInterface, QueryRunner } from 'typeorm';
import { exigirBancoEmUtc } from '../preflight/banco-em-utc';

export class RemainingTimestampsWithTimeZone1761000400000 implements MigrationInterface {
  name = 'RemainingTimestampsWithTimeZone1761000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await exigirBancoEmUtc(queryRunner, this.name);
    await queryRunner.query(`
        ALTER TABLE "appointments"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinic_rooms"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinics"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinical_record_templates"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinical_records"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "doctor_headers"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "doctor_profiles"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "health_plans"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "hospitals"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "manufacturers"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "opme_items"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "patients"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "payment_gateway_events"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "procedures"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "subscription_plans"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "subscription_quota_periods"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "subscriptions"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "suppliers"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_activity_mentions"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_quotations"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_templates"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_tuss_items"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "user_doctor_accesses"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "user_notification_settings"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "users"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "appointments"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinic_rooms"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinics"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinical_record_templates"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "clinical_records"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "doctor_headers"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "doctor_profiles"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "health_plans"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "hospitals"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "manufacturers"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "opme_items"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "patients"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "payment_gateway_events"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "procedures"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "subscription_plans"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "subscription_quota_periods"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "subscriptions"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "suppliers"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_activity_mentions"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_quotations"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_templates"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_tuss_items"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "user_doctor_accesses"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "user_notification_settings"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "users"
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "deleted_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "deleted_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }
}
