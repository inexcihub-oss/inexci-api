import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tipo novo de notificação: menção (@) num comentário da solicitação.
 *
 * `ALTER TYPE ... ADD VALUE` roda dentro de transação a partir do Postgres
 * 12 (aqui é o 16) desde que o valor novo não seja **usado** na mesma
 * transação — esta migration só declara, quem usa é a aplicação depois.
 *
 * `IF NOT EXISTS` porque o rollback abaixo não remove o valor: Postgres não
 * suporta `DROP VALUE`, e recriar o tipo inteiro exigiria reescrever a
 * coluna de todas as notificações existentes. Um valor de enum sem uso é
 * inerte; reverter esta migration e rodá-la de novo precisa ser seguro.
 */
export class AddMentionToNotificationTypeEnum1755700600000 implements MigrationInterface {
  name = 'AddMentionToNotificationTypeEnum1755700600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'mention';`,
    );
  }

  public async down(): Promise<void> {
    // Intencionalmente vazio — ver o comentário acima.
  }
}
