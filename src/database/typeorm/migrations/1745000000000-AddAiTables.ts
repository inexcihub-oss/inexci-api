import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiTables1745000000000 implements MigrationInterface {
  // Roda fora de transação para permitir CREATE EXTENSION
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tentar instalar a extensão vector (pgvector).
    // Se não estiver disponível no sistema, a tabela ai_knowledge_chunk
    // será criada sem o campo embedding (sem suporte a busca vetorial).
    const vectorResult = await queryRunner
      .query(`SELECT 1 FROM pg_available_extensions WHERE name = 'vector';`)
      .catch(() => []);
    const hasVector = vectorResult && vectorResult.length > 0;

    if (hasVector) {
      await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS ai_knowledge_chunk (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          category VARCHAR(50) NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          embedding vector(1536),
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
        ON ai_knowledge_chunk
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
      `);
    } else {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS ai_knowledge_chunk (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          category VARCHAR(50) NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_conversation (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        user_id UUID REFERENCES "user"(id),
        messages_history JSONB DEFAULT '[]',
        started_at TIMESTAMPTZ DEFAULT now(),
        last_message_at TIMESTAMPTZ DEFAULT now(),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_conversation_phone ON whatsapp_conversation(phone);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_conversation_active ON whatsapp_conversation(active, last_message_at);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS whatsapp_conversation;`);
    await queryRunner.query(`DROP TABLE IF EXISTS ai_knowledge_chunk;`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector;`);
  }
}
