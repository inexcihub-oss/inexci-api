import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase5SecurityLgpd1763049600000 implements MigrationInterface {
  name = 'Phase5SecurityLgpd1763049600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // T31: Tabela de log de cleanup para idempotência
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversation_cleanup_log (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        deleted_count INTEGER NOT NULL DEFAULT 0,
        cutoff_date TIMESTAMPTZ NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cleanup_log_executed
        ON conversation_cleanup_log (executed_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cleanup_log_executed;`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS conversation_cleanup_log CASCADE;`,
    );
  }
}
