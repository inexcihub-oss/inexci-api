import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionInternalAccess1761000900000 implements MigrationInterface {
  name = 'AddSubscriptionInternalAccess1761000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "internal_access_granted_by" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN "internal_access_granted_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "internal_access_granted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "internal_access_granted_by"`,
    );
  }
}
