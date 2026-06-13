import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 0 do PLANO Blueprint v3 — instrumentação de telemetria.
 *
 * Adiciona colunas a `ai_token_usage_logs` para suportar o novo modelo
 * arquitetural (tiers de modelo, planner explícito, pipelines determinísticos
 * de STT/OCR, tools com custo individual):
 *
 *  - `tier`              (text, nullable): tier resolvido pelo Model Gateway
 *                        (`cheap`, `standard`, `premium`, `vision`,
 *                        `embedding`). Null = ainda não migrado para gateway.
 *  - `tools_invoked`     (jsonb): array `[{name, duration_ms, status}]`
 *                        com granularidade por tool. Substitui o agregado
 *                        por stage do `breakdown` para análise de custo
 *                        e error rate por ferramenta.
 *  - `planner_intent`    (text, nullable): intent classificado pelo planner
 *                        (`create_sc`, `query_sc`, `smalltalk`, ...).
 *  - `draft_type`        (text, nullable): cópia denormalizada do
 *                        `operationDraft.type` no início do turno (já
 *                        existe redundantemente em `breakdown[].draftType`,
 *                        mas indexar é caro em jsonb).
 *  - `extraction_source` (jsonb, nullable):
 *                        `{audio: 'cache'|'live'|null,
 *                          doc:   'cache'|'ocr'|'vision'|null}`.
 *                        Habilita observação de hit-rate dos caches SHA256
 *                        de STT/OCR (Fases 4 e 5 do blueprint).
 *
 * Todas as colunas são nullable para garantir compatibilidade com linhas
 * existentes e com o caminho legado durante o roll-out das fases seguintes.
 */
export class AddAiTelemetryColumns1747300000000
  implements MigrationInterface
{
  name = 'AddAiTelemetryColumns1747300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_token_usage_logs"
        ADD COLUMN IF NOT EXISTS "tier"              TEXT,
        ADD COLUMN IF NOT EXISTS "tools_invoked"     JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "planner_intent"    TEXT,
        ADD COLUMN IF NOT EXISTS "draft_type"        TEXT,
        ADD COLUMN IF NOT EXISTS "extraction_source" JSONB;
    `);

    // Índices voltados a relatórios de custo / hit-rate.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_tier"
        ON "ai_token_usage_logs" ("tier", "created_at")
        WHERE "tier" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_planner_intent"
        ON "ai_token_usage_logs" ("planner_intent", "created_at")
        WHERE "planner_intent" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ai_token_usage_draft_type"
        ON "ai_token_usage_logs" ("draft_type", "created_at")
        WHERE "draft_type" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_token_usage_draft_type";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_token_usage_planner_intent";`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ai_token_usage_tier";`);
    await queryRunner.query(`
      ALTER TABLE "ai_token_usage_logs"
        DROP COLUMN IF EXISTS "extraction_source",
        DROP COLUMN IF EXISTS "draft_type",
        DROP COLUMN IF EXISTS "planner_intent",
        DROP COLUMN IF EXISTS "tools_invoked",
        DROP COLUMN IF EXISTS "tier";
    `);
  }
}
