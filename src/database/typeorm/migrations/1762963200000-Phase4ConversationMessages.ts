import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase4ConversationMessages1762963200000 implements MigrationInterface {
  name = 'Phase4ConversationMessages1762963200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // T20: Criar tabela whatsapp_conversation_message
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_conversation_message (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        conversation_id UUID NOT NULL,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        tool_name VARCHAR(100),
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_wcm_conversation"
          FOREIGN KEY (conversation_id)
          REFERENCES whatsapp_conversation(id)
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_wcm_conversation_created
        ON whatsapp_conversation_message (conversation_id, created_at);
    `);

    // T21: Migration de dados — explodir messages_history jsonb em linhas
    await queryRunner.query(`
      INSERT INTO whatsapp_conversation_message
        (conversation_id, role, content, tool_name, metadata, created_at)
      SELECT
        wc.id,
        msg->>'role',
        COALESCE(msg->>'content', ''),
        msg->>'tool_name',
        msg->'metadata',
        COALESCE(
          (msg->>'timestamp')::timestamptz,
          wc.created_at
        )
      FROM whatsapp_conversation wc
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN wc.messages_history IS NOT NULL
            AND jsonb_typeof(wc.messages_history) = 'array'
            AND jsonb_array_length(wc.messages_history) > 0
          THEN wc.messages_history
          ELSE '[]'::jsonb
        END
      ) AS msg
      WHERE wc.messages_history IS NOT NULL
        AND jsonb_typeof(wc.messages_history) = 'array'
        AND jsonb_array_length(wc.messages_history) > 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_wcm_conversation_created;`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS whatsapp_conversation_message CASCADE;`,
    );
  }
}
