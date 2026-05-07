import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona resumo + memória estruturada à conversa do WhatsApp.
 *
 * Plano de redução de tokens (Fase 1): a IA passa a montar o contexto
 * híbrido (system + summary + memory + janela curta + RAG) em vez de
 * reenviar o histórico bruto a cada turno.
 *
 * Reversível: o `down` remove apenas as colunas adicionadas; nada do
 * histórico bruto (`messages_history`) é tocado.
 */
export class AddConversationSummaryAndMemory1763222400000 implements MigrationInterface {
  name = 'AddConversationSummaryAndMemory1763222400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "whatsapp_conversation"
        ADD COLUMN IF NOT EXISTS "conversation_summary" text,
        ADD COLUMN IF NOT EXISTS "conversation_memory" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "summary_updated_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "summary_version" int NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "whatsapp_conversation"
        DROP COLUMN IF EXISTS "summary_version",
        DROP COLUMN IF EXISTS "summary_updated_at",
        DROP COLUMN IF EXISTS "conversation_memory",
        DROP COLUMN IF EXISTS "conversation_summary"
    `);
  }
}
