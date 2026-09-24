import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Toggle do e-mail de menção (@) em comentários da solicitação.
 *
 * Só o canal de e-mail: a notificação dentro da plataforma continua regida
 * por `push_notifications`. Nasce `true` porque, até aqui, ser mencionado
 * não gerava aviso nenhum — ninguém optou por não receber.
 *
 * `ADD COLUMN ... NOT NULL DEFAULT true` preenche as linhas existentes na
 * própria operação; não há dado legado que possa violar a restrição e,
 * portanto, nada a registrar em `preflight/data-checks.ts`.
 */
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
