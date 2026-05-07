import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase1StandardizationAndIndexes1762704000000 implements MigrationInterface {
  name = 'Phase1StandardizationAndIndexes1762704000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // T2: metadata text → jsonb em ai_knowledge_chunk
    await queryRunner.query(`
      ALTER TABLE ai_knowledge_chunk
        ALTER COLUMN metadata TYPE jsonb
        USING NULLIF(metadata, '')::jsonb;
    `);

    // T5: ON DELETE SET NULL no FK user_id de whatsapp_conversation
    // Drop qualquer FK existente em user_id (nome pode variar)
    await queryRunner.query(`
      DO $$
      DECLARE
        _name TEXT;
      BEGIN
        FOR _name IN
          SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = 'whatsapp_conversation'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = 'user_id'
        LOOP
          EXECUTE format('ALTER TABLE whatsapp_conversation DROP CONSTRAINT %I', _name);
        END LOOP;
      END $$;
    `);

    // T5 (cont.): Recria FK com ON DELETE SET NULL
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE whatsapp_conversation
          ADD CONSTRAINT "FK_whatsapp_conversation_user"
          FOREIGN KEY ("user_id") REFERENCES "user"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // T6: Unique parcial (phone) WHERE active = true
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_phone_active
        ON whatsapp_conversation (phone)
        WHERE active = true;
    `);

    // T7: Índice (category, active) em ai_knowledge_chunk
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_category_active
        ON ai_knowledge_chunk (category, active);
    `);

    // T8: Índices em ai_token_usage_log
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user_created_at
        ON ai_token_usage_log (user_id, created_at);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_token_usage_created_at
        ON ai_token_usage_log (created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // T8: remover índices
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_ai_token_usage_created_at;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_ai_token_usage_user_created_at;`,
    );

    // T7: remover índice
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_knowledge_category_active;`,
    );

    // T6: remover unique parcial
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_conversation_phone_active;`,
    );

    // T5: reverter FK (sem ON DELETE SET NULL)
    await queryRunner.query(`
      ALTER TABLE whatsapp_conversation
        DROP CONSTRAINT IF EXISTS "FK_whatsapp_conversation_user";
    `);

    // T2: reverter metadata para text
    await queryRunner.query(`
      ALTER TABLE ai_knowledge_chunk
        ALTER COLUMN metadata TYPE text
        USING metadata::text;
    `);
  }
}
