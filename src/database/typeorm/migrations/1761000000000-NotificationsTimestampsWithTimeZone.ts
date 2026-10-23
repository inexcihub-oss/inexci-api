import { MigrationInterface, QueryRunner } from 'typeorm';
import { exigirBancoEmUtc } from '../preflight/banco-em-utc';

export class NotificationsTimestampsWithTimeZone1761000000000 implements MigrationInterface {
  name = 'NotificationsTimestampsWithTimeZone1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await exigirBancoEmUtc(queryRunner, this.name);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE
          USING "created_at" AT TIME ZONE current_setting('TimeZone'),
        ALTER COLUMN "updated_at" TYPE TIMESTAMP WITH TIME ZONE
          USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "created_at" TYPE TIMESTAMP WITHOUT TIME ZONE
          USING "created_at" AT TIME ZONE current_setting('TimeZone'),
        ALTER COLUMN "updated_at" TYPE TIMESTAMP WITHOUT TIME ZONE
          USING "updated_at" AT TIME ZONE current_setting('TimeZone')
    `);
  }
}
