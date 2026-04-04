import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddWhatsappMessageLog1743600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "whatsapp_message_log_status_enum" AS ENUM ('sent', 'failed')
    `);

    await queryRunner.createTable(
      new Table({
        name: 'whatsapp_message_log',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'to',
            type: 'varchar',
            length: '20',
          },
          {
            name: 'body',
            type: 'text',
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['sent', 'failed'],
            default: "'sent'",
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'sent_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('whatsapp_message_log');
    await queryRunner.query(
      `DROP TYPE IF EXISTS "whatsapp_message_log_status_enum"`,
    );
  }
}
