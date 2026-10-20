import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameCancelReasonToClosedReason1752200000000 implements MigrationInterface {
  name = 'RenameCancelReasonToClosedReason1752200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
      RENAME COLUMN "cancel_reason" TO "closed_reason";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
      RENAME COLUMN "closed_reason" TO "cancel_reason";
    `);
  }
}
