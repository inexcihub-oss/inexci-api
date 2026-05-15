import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 6 do Blueprint v3 — memória persistente.
 *
 * `ai_persistent_memory` armazena preferências, entidades recorrentes,
 * padrões e metas por usuário. Acessível por **todas** as conversas
 * do mesmo usuário (vs. `conversation_memory` que é por conversa).
 *
 * Exemplos de chaves:
 *   - scope=preference, key=preferred_hospital_id
 *   - scope=entity,     key=frequent_health_plan_id
 *   - scope=pattern,    key=typical_tuss_codes
 *   - scope=goal,       key=weekly_workflow
 *
 * Decisão de scope: chave composta `(user_id, scope, key)`. NUNCA
 * `owner_id` — preferências são pessoais (LGPD).
 */
export class CreateAiPersistentMemory1747500000000
  implements MigrationInterface
{
  name = 'CreateAiPersistentMemory1747500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_persistent_memory" (
        "user_id"      UUID NOT NULL,
        "scope"        TEXT NOT NULL,
        "key"          TEXT NOT NULL,
        "value"        JSONB NOT NULL,
        "confidence"   NUMERIC(3,2),
        "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "use_count"    INT NOT NULL DEFAULT 0,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_persistent_memory" PRIMARY KEY ("user_id", "scope", "key"),
        CONSTRAINT "fk_apm_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_apm_user_lastused"
         ON "ai_persistent_memory" ("user_id", "last_used_at" DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_apm_scope"
         ON "ai_persistent_memory" ("scope");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_apm_scope";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_apm_user_lastused";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_persistent_memory";`);
  }
}
