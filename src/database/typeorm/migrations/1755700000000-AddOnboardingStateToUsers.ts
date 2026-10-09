import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingStateToUsers1755700000000 implements MigrationInterface {
  name = 'AddOnboardingStateToUsers1755700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "onboarding_state" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "onboarding_state"`,
    );
  }
}
