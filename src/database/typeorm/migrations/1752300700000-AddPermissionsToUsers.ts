import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona `permissions` (text[], default '{}') a `users` — áreas de trabalho
 * concedidas explicitamente a um colaborador. Não é a permissão efetiva:
 * `resolveEffectivePermissions` combina esta coluna com o papel (admin/médico)
 * do usuário.
 *
 * Backfill: colaborador existente recebe as três áreas de trabalho
 * (agenda, atendimento, solicitacoes) para não perder acesso no deploy.
 * Usuários com role='admin' ficam com o array vazio de propósito — recebem
 * tudo por derivação em `resolveEffectivePermissions`.
 */
export class AddPermissionsToUsers1752300700000 implements MigrationInterface {
  name = 'AddPermissionsToUsers1752300700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "permissions" text array NOT NULL DEFAULT '{}'`,
    );

    // Colaborador que já existe não pode perder acesso no deploy: recebe as
    // três áreas de trabalho, sem Administração. Quem tem role='admin' fica
    // com o array vazio de propósito — recebe tudo por derivação.
    await queryRunner.query(`
      UPDATE "users"
         SET "permissions" = ARRAY['agenda','atendimento','solicitacoes']::text[]
       WHERE "role" = 'collaborator'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "permissions"`);
  }
}
