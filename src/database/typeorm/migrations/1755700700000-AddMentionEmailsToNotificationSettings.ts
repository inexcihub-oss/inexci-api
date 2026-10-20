import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMentionEmailsToNotificationSettings1755700700000 implements MigrationInterface {
  name = 'AddMentionEmailsToNotificationSettings1755700700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_notification_settings" ADD COLUMN "mention_emails" BOOLEAN NOT NULL DEFAULT true;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_notification_settings" DROP COLUMN "mention_emails";`,
    );
  }
}
