import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona a coluna `operation_draft` (jsonb nullable) a
 * `whatsapp_conversations`. Armazena o draft estruturado de uma operação
 * complexa em andamento (criação de SC, cadastro de paciente, faturamento,
 * contestação, agendamento, atualização de dados).
 *
 * Schema flexível discriminado pelo campo `type`. O draft é orquestrado pelo
 * `OperationDraftService` e preenchido em qualquer ordem pelas tools
 * `*_draft_set_*`. Quando completo, vira `pending_confirmation` e é
 * commitado pela tool `*_draft_commit`.
 *
 * Decisões:
 *  - Nullable: conversas sem operação ativa não ocupam espaço extra.
 *  - JSONB único em vez de tabela separada: padrão já existente
 *    (`conversation_memory`); evita JOIN em todo turno.
 *  - Índice parcial em `type` para permitir métricas/queries de operações
 *    em andamento por tipo sem varrer toda a tabela.
 */
export class AddOperationDraftToWhatsappConversations1746780000000 implements MigrationInterface {
  name = 'AddOperationDraftToWhatsappConversations1746780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "whatsapp_conversations"
      ADD COLUMN "operation_draft" JSONB;
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_wc_operation_draft_type"
        ON "whatsapp_conversations" (("operation_draft"->>'type'))
        WHERE "operation_draft" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_wc_operation_draft_type";`,
    );
    await queryRunner.query(`
      ALTER TABLE "whatsapp_conversations"
      DROP COLUMN IF EXISTS "operation_draft";
    `);
  }
}
