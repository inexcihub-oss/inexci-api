import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona `onboarding_state` (jsonb, nullable) a `users`.
 *
 * Sem default e sem backfill: `NULL` significa "nunca começou", que é
 * exatamente o estado em que todo usuário existente deve ficar no dia do
 * deploy — é o que dispara o modal de boas-vindas para eles também.
 *
 * Aditiva e permissiva (nada de NOT NULL, UNIQUE ou CHECK), então não precisa
 * de entrada em `preflight/data-checks.ts`.
 */
export class AddOnboardingStateToUsers1755700000000
  implements MigrationInterface
{
  name = 'AddOnboardingStateToUsers1755700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "onboarding_state" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "onboarding_state"`,
    );
  }
}
