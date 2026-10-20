import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMentionToNotificationTypeEnum1755700600000 implements MigrationInterface {
  name = 'AddMentionToNotificationTypeEnum1755700600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'mention';`,
    );
  }

  public async down(): Promise<void> {}
}
