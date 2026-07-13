import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `cancel_reason` só é preenchido hoje pelo fluxo de encerramento (POST /surgery-requests/:id/close).
 * Renomeada para `closed_reason` para refletir seu uso real: motivo do encerramento da SC.
 */
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
