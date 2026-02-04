import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateNotificationsTables1768713000000 implements MigrationInterface {
  name = 'CreateNotificationsTables1768713000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Criar tabela user_notification_settings
    await queryRunner.createTable(
      new Table({
        name: 'user_notification_settings',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'user_id',
            type: 'int',
          },
          {
            name: 'email_notifications',
            type: 'boolean',
            default: true,
          },
          {
            name: 'sms_notifications',
            type: 'boolean',
            default: false,
          },
          {
            name: 'push_notifications',
            type: 'boolean',
            default: true,
          },
          {
            name: 'new_surgery_request',
            type: 'boolean',
            default: true,
          },
          {
            name: 'status_update',
            type: 'boolean',
            default: true,
          },
          {
            name: 'pendencies',
            type: 'boolean',
            default: true,
          },
          {
            name: 'expiring_documents',
            type: 'boolean',
            default: true,
          },
          {
            name: 'weekly_report',
            type: 'boolean',
            default: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Criar FK para user_notification_settings
    await queryRunner.createForeignKey(
      'user_notification_settings',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'user',
        onDelete: 'CASCADE',
      }),
    );

    // Criar tipo enum para notification type
    await queryRunner.query(`
      CREATE TYPE notification_type_enum AS ENUM (
        'new_surgery_request',
        'status_update',
        'pendency',
        'expiring_document',
        'system',
        'info'
      )
    `);

    // Criar tabela notification
    await queryRunner.createTable(
      new Table({
        name: 'notification',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'user_id',
            type: 'int',
          },
          {
            name: 'type',
            type: 'notification_type_enum',
            default: "'info'",
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'message',
            type: 'text',
          },
          {
            name: 'read',
            type: 'boolean',
            default: false,
          },
          {
            name: 'link',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Criar FK para notification
    await queryRunner.createForeignKey(
      'notification',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'user',
        onDelete: 'CASCADE',
      }),
    );

    // Criar índice para buscar notificações do usuário
    await queryRunner.query(`
      CREATE INDEX idx_notification_user_id ON notification(user_id)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_notification_user_read ON notification(user_id, read)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remover índices
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notification_user_read`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notification_user_id`);

    // Remover tabela notification
    await queryRunner.dropTable('notification');

    // Remover enum type
    await queryRunner.query(`DROP TYPE IF EXISTS notification_type_enum`);

    // Remover tabela user_notification_settings
    await queryRunner.dropTable('user_notification_settings');
  }
}
