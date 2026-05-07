import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase3MultiTenantAccountId1762876800000 implements MigrationInterface {
  name = 'Phase3MultiTenantAccountId1762876800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // T13: account_id em whatsapp_conversation
    await queryRunner.query(`
      ALTER TABLE whatsapp_conversation
        ADD COLUMN IF NOT EXISTS account_id UUID;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_wc_account
        ON whatsapp_conversation (account_id);
    `);

    // T14: account_id em ai_token_usage_log
    await queryRunner.query(`
      ALTER TABLE ai_token_usage_log
        ADD COLUMN IF NOT EXISTS account_id UUID;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_atul_account
        ON ai_token_usage_log (account_id);
    `);

    // T15: account_id em whatsapp_message_log
    await queryRunner.query(`
      ALTER TABLE whatsapp_message_log
        ADD COLUMN IF NOT EXISTS account_id UUID;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_wml_account
        ON whatsapp_message_log (account_id);
    `);

    // T17: Backfill account_id via JOIN com user
    await queryRunner.query(`
      UPDATE whatsapp_conversation wc
        SET account_id = u.account_id
        FROM "user" u
        WHERE wc.user_id = u.id
          AND wc.account_id IS NULL;
    `);

    await queryRunner.query(`
      UPDATE ai_token_usage_log atl
        SET account_id = u.account_id
        FROM "user" u
        WHERE atl.user_id = u.id
          AND atl.account_id IS NULL;
    `);

    await queryRunner.query(`
      UPDATE whatsapp_message_log wml
        SET account_id = u.account_id
        FROM "user" u
        WHERE wml.user_id = u.id
          AND wml.account_id IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_wml_account;`);
    await queryRunner.query(`
      ALTER TABLE whatsapp_message_log
        DROP COLUMN IF EXISTS account_id;
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_atul_account;`);
    await queryRunner.query(`
      ALTER TABLE ai_token_usage_log
        DROP COLUMN IF EXISTS account_id;
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_wc_account;`);
    await queryRunner.query(`
      ALTER TABLE whatsapp_conversation
        DROP COLUMN IF EXISTS account_id;
    `);
  }
}
