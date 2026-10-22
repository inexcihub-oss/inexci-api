import { MigrationInterface, QueryRunner } from 'typeorm';

export class BillingAnalysisContestationTimestampsWithTimeZone1761000200000 implements MigrationInterface {
  name = 'BillingAnalysisContestationTimestampsWithTimeZone1761000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "contestations"
          ALTER COLUMN "resolved_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "resolved_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_billings"
          ALTER COLUMN "invoice_sent_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "invoice_sent_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "received_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "contested_received_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "contested_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_analyses"
          ALTER COLUMN "received_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "quotation_1_received_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "quotation_1_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "quotation_2_received_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "quotation_2_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "quotation_3_received_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "quotation_3_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "contestations"
          ALTER COLUMN "resolved_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "resolved_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_billings"
          ALTER COLUMN "invoice_sent_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "invoice_sent_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "received_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "contested_received_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "contested_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
    await queryRunner.query(`
        ALTER TABLE "surgery_request_analyses"
          ALTER COLUMN "received_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "quotation_1_received_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "quotation_1_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "quotation_2_received_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "quotation_2_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "quotation_3_received_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "quotation_3_received_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "created_at" AT TIME ZONE current_setting('TimeZone'),
          ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
            USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }
}
