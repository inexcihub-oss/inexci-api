import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionDiscount1761001200000 implements MigrationInterface {
  name = 'AddSubscriptionDiscount1761001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "discount_percent_off" numeric(6,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "discount_amount_off_cents" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "discount_duration" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "discount_ends_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "discount_ends_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "discount_duration"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "discount_amount_off_cents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "discount_percent_off"`,
    );
  }
}
