import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiUsageSource1761001000000 implements MigrationInterface {
  name = 'AddAiUsageSource1761001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_token_usage_logs" ADD COLUMN "source" character varying(30) NOT NULL DEFAULT 'whatsapp'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_token_usage_logs" ALTER COLUMN "message_sid" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_token_usage_logs" ALTER COLUMN "phone_hash" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_token_usage_logs" DROP COLUMN "source"`,
    );
  }
}
